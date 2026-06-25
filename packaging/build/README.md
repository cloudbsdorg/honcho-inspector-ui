# Multi-distro package build matrix

This directory contains one Containerfile + one POSIX-shell entrypoint per
supported Linux distribution. Each pair builds a **native** package for that
distro — `.deb` for Debian-family, `.rpm` for RHEL/SUSE-family, `.apk` for
Alpine, `.pkg.tar.zst` for Arch, `.xbps` for Void — and writes the artifact
to `/out` (the operator binds `$PWD/../dist` to `/out`).

The build is **driven entirely by bind mounts** — no source tree is baked
into any image, no `podman cp` is needed, and the produced artifact is
**owned by the operator** on the host filesystem (no root-owned files that
need `sudo chown`).

| Distro | Format | Base image | Builder |
|---|---|---|---|
| Debian 13 (trixie) | `.deb` | `docker.io/library/debian:13-slim` | `fpm -t deb` |
| Rocky Linux 10 | `.rpm` | `docker.io/library/rockylinux:10-minimal` | `fpm -t rpm` |
| openSUSE Leap 16 | `.rpm` | `docker.io/library/opensuse/leap:16.0` | `fpm -t rpm` |
| Alpine 3.22 | `.apk` | `docker.io/library/alpine:3.22` | `fpm -t apk` |
| Arch Linux (rolling) | `.pkg.tar.zst` | `docker.io/library/archlinux:latest` | `makepkg` + generated PKGBUILD |
| Void Linux (glibc) | `.xbps` | `docker.io/voidlinux/voidlinux:glibc` | `xbps-create` + generated install-action |

## Operator workflow

### One-time: build the build image

```bash
# Pick the distro you want to target. Repeat for each distro you want to ship.
podman build --build-arg HOST_UID=$(id -u) --build-arg HOST_GID=$(id -g) \
    -t honcho-inspector-ui:builder-<distro> \
    -f packaging/build/<distro>/Containerfile .
```

The `--build-arg HOST_UID` and `--build-arg HOST_GID` are forwarded into the
entrypoint, which runs `chown -R $HOST_UID:$HOST_GID /out` at the end. Without
them, the artifact lands in your `dist/` directory owned by root (uid 0 / gid 0).

### Each build: run the build container, capture the artifact

```bash
# From the repo root, with $PWD as the source tree and $PWD/../dist as
# the artifact destination (the dist/ dir is shared between honcho-
# inspector-backend and honcho-inspector-ui so the two packages sit
# side by side for distribution):
mkdir -p ../dist
podman run --rm \
    -v $PWD:/src:ro \
    -v $PWD/../dist:/out:rw \
    honcho-inspector-ui:builder-<distro>
```

The entrypoint prints `BUILT: /out/<artifact>` on success. Common artifacts:

```
honcho-inspector-ui_0.1.0-SNAPSHOT_all.deb                  # debian
honcho-inspector-ui-0.1.0-SNAPSHOT-1.noarch.rpm             # rocky / suse
honcho-inspector-ui-0.1.0-SNAPSHOT.apk                      # alpine
honcho-inspector-ui-0.1.0.SNAPSHOT-1-x86_64.pkg.tar.zst     # arch
honcho-inspector-ui-0.1.0-SNAPSHOT_1.x86_64.xbps            # void
```

### Smoke-test: install the artifact in a matching distro

The point of native packaging is that the package installs with the host's
package manager. Smoke-test before shipping:

```bash
# Debian
podman run --rm -v $PWD/../dist:/dist:ro debian:13-slim \
    bash -c 'apt update && apt install -y /dist/*.deb && \
             systemctl start honcho-inspector-ui && \
             sleep 60 && curl -fsS http://127.0.0.1:4200/'

# Rocky
podman run --rm -v $PWD/../dist:/dist:ro rockylinux:10-minimal \
    bash -c 'dnf install -y /dist/*.rpm && \
             systemctl start honcho-inspector-ui && \
             sleep 60 && curl -fsS http://127.0.0.1:4200/'

# (similar for suse / alpine / arch / void)
```

The UI's systemd unit has `ExecStartPre=npm ci --omit=dev` which downloads
the dependency tree on first boot — allow 30-60s on a fresh box for npm to
finish before the `curl` check.

For Void, the smoke test is different because Void uses runit, not systemd:

```bash
podman run --rm -v $PWD/../dist:/dist:ro voidlinux/voidlinux:glibc \
    bash -c 'xbps-install -y /dist/*.xbps && \
             ln -s /etc/sv/honcho-inspector-ui /var/service/ && \
             sv up honcho-inspector-ui && \
             sleep 60 && curl -fsS http://127.0.0.1:4200/'
```

## Per-distro notes

### Debian 13 (trixie)

- **Node 24** is NOT in trixie main (only Node 20). The Containerfile adds
  Nodesource's `setup_24.x` repo via the modern
  `/etc/apt/keyrings/nodesource.gpg` + `signed-by=` pattern. We do NOT use
  `apt-key` (deprecated in Debian 11, removed in Debian 12).
- **fpm** is NOT in Debian (Debian's `fpm` package is the unrelated Fortran
  project "fpm2"). The Containerfile installs fpm as a Ruby gem.

### Rocky Linux 10

- **Node 24** is in AppStream as `nodejs24` (1:24.14.1-2.el10_1).
- The `crb` repo is enabled inside the Containerfile to satisfy `-devel`
  package builds (fpm's native extensions need `gcc`, `make`, etc.).
- The postinst is generated inside the entrypoint using shadow's
  `useradd`/`groupadd` (NOT Debian's `adduser --system`).

### openSUSE Leap 16

- **Node 24** is in the **Package Hub** repo (not in main OSS). Package
  Hub is enabled by default on Leap 16.
- The postinst is generated inside the entrypoint (SUSE's `zypper` doesn't
  share Debian's `adduser` semantics).

### Alpine 3.22

- **Node 24** is NOT in v3.22 main. The Containerfile adds the
  `edge/community` repo at lower priority so `nodejs24` is reachable while
  still preferring v3.22 main for everything else.
- The postinst is generated inside the entrypoint (BusyBox's `adduser`
  syntax differs from shadow's; we generate the BusyBox-flavored version).

### Arch Linux

- **Node 24**: `nodejs-lts-krypton` (the codename for Node 24 LTS).
- **fpm is not used.** Arch uses `makepkg` against a PKGBUILD. The PKGBUILD
  and `.INSTALL` files are generated dynamically inside the entrypoint
  (version bumps would otherwise drift in a hand-written PKGBUILD).
- `makepkg` refuses to run as root. The entrypoint creates a `build` user
  and runs `runuser -u build -- bash -c "cd ... && fakeroot makepkg ..."`.
- The artifact name follows pacman's convention with the arch suffix:
  `honcho-inspector-ui-0.1.0.SNAPSHOT-1-x86_64.pkg.tar.zst`.

### Void Linux

- **Glibc flavor**, not musl — Void's default musl image has occasional
  symbol mismatches with Node's native helpers (`ngcc`, `undici`).
- The `.xbps` is built via `xbps-create`, not fpm (fpm has no Void target).
- **Both** a systemd unit AND a runit runscript tree are shipped inside the
  package. The `post_install()` script in the install-action detects which
  init system is present and activates the matching service. This is the
  `k3s` pattern from k3s-io/k3s#13349 — the operator's box may have either
  init system, and the package "just works" on both.
- The detection priority is **runit first** (Void's default), with a
  fallback to **systemd**. If neither is present, the package installs but
  the service stays inactive until the operator configures an init system.

## Why the UI ships SOURCE, not a built `dist/`

The Angular dev server (`ng serve`) **is** the runtime — per project
convention, we don't pre-compile to a static `dist/` + nginx setup. The deb
ships the source tree only, with no `node_modules` directory. The systemd
unit's `ExecStartPre=npm ci --omit=dev` runs on first boot to install
dependencies and pull the correct host-arch native binaries
(`@esbuild/linux-x64/bin/esbuild` or `@esbuild/linux-arm64/bin/esbuild`,
etc.). This keeps the deb genuinely `Architecture: all` instead of being
an amd64-only package with hard-coded native binaries.

First-boot cost: 30-60s of npm install. Subsequent boots are a no-op
because npm checks the lockfile against the installed tree.

## Why no flatpak or snap?

`honcho-inspector-ui` is a long-running daemon-style service:

- It binds on `0.0.0.0:4200` and proxies `/api/*` to the backend on
  loopback `:8080`.
- It writes to `/var/lib/honcho-inspector-ui` (npm cache, Angular Vite
  cache).
- It is supervised by systemd (or runit on Void) with restart-on-fail
  semantics.

Both **flatpak** and **snap** are designed for **sandboxed user-facing
desktop apps** distributed through a central store. The sandbox model
fights hard against port-binding (snap's `network-bind` interface,
flatpak's `--add-interface=network`) and against persistent `/var/lib`
state (snap's home + system-backup interfaces, flatpak's
`--filesystem=host`). Neither has a clean story for a daemon supervised by
an init system.

For an admin tool deployed on dedicated boxes where the operator picks the
distro, native packaging (`.deb`/`.rpm`/`.apk`/`.pkg.tar.zst`/`.xbps`) is
the correct shape. It uses each distro's package manager, integrates with
each distro's init system, and updates through each distro's normal
update channels.

If a future use case emerges — say, a one-click GUI installer for
non-technical operators on Ubuntu — **snap** becomes viable as a
single-bundle alternative. It would still require designing the UI around
snap's confinement model, which is a different project.

## License

BSD-3-Clause. See `LICENSE`.