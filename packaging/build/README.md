# Multi-distro package build matrix

This directory contains one Containerfile + one POSIX-shell entrypoint per
supported Linux distribution. Each pair builds a **native** package for that
distro — `.deb` for Debian-family, `.rpm` for RHEL/SUSE-family, `.apk` for
Alpine, `.pkg.tar.zst` for Arch, `.xbps` for Void.

The build is invoked from the repo root via the `make packages-*` target
(see [Repeatable build](#repeatable-build-with-make-packages) below). The
build container reads the source tree from `/src` (bind-mounted read-only)
and writes the artifact to `/out` inside a **podman-managed named volume**
(not a host bind-mount). After the container exits we use `podman cp` /
`docker cp` to extract the artifact to `<repo>/dist/packages/<distro>/`,
where it lands owned by the operator and ready to move/install/rm without
sudo.

| Distro | Format | Base image | Builder |
|---|---|---|---|
| Debian 13 (trixie) | `.deb` | `docker.io/library/debian:13-slim` | `fpm -t deb` |
| Rocky Linux 10 | `.rpm` | `docker.io/library/rockylinux:10-minimal` | `fpm -t rpm` |
| openSUSE Leap 16 | `.rpm` | `docker.io/library/opensuse/leap:16.0` | `fpm -t rpm` |
| Alpine 3.22 | `.apk` | `docker.io/library/alpine:3.22` | `fpm -t apk` |
| Arch Linux (rolling) | `.pkg.tar.zst` | `docker.io/library/archlinux:latest` | `makepkg` + generated PKGBUILD |
| Void Linux (glibc) | `.xbps` | `docker.io/voidlinux/voidlinux:glibc` | `xbps-create` + generated install-action |

## Operator workflow

### Repeatable build with `make packages`

The repo-root Makefile auto-detects `podman` (preferred) or `docker` and
drives the per-distro build + extract. Each target produces one artifact
under `<repo>/dist/packages/<distro>/`, owned by the operator. The
project also builds the same matrix for `honcho-inspector-ui` (see that
repo's Makefile for the `packages-*` target list).

```bash
# from the repo root:
make help                        # show all targets; look for packages-*
make packages-debian             # build the Debian .deb only
make packages-rocky              # build the Rocky .rpm only
make packages-suse alpine arch void
make packages                    # alias for packages-all (build all six)
make packages-all                # build every supported distro, in order
make packages-clean              # remove dist/packages/ (the whole tree)
```

The wrapper script (`packaging/scripts/build-package.sh`) takes care of:

1. **Resolving the runtime**: `podman` first, `docker` as fallback. If
   neither is installed the script prints install hints and exits 1.
2. **Building the per-distro build image**: `${repo}:builder-${distro}`
   (`--pull=false`; only re-pulls base images when the user manually
   asks).
3. **Running the build container detached** with the project tree
   bind-mounted to `/src` (read-only) and a freshly-created podman
   named volume mounted at `/out`.
4. **Polling until the container exits** (success → exit 0; failure →
   print last 200 log lines + non-zero exit).
5. **Extracting the artifact** via `podman cp` / `docker cp` from the
   named volume (which survives container exit) into
   `<repo>/dist/packages/<distro>/`. The cp writes the file owned by
   the operator -- `mv`, `rm`, `dpkg -i` all work without sudo.

Override flags can be passed through the `BUILD_PACKAGE_EXTRA_ARGS` make
variable (for example, `--no-cache` to force a rebuild of a layer):

```bash
make packages-debian BUILD_PACKAGE_EXTRA_ARGS=--no-cache
```

To remove the whole artifact tree:

```bash
make packages-clean
```

The artifact lands in `<repo>/dist/packages/<distro>/<name>` owned by
the operator:

```
$ make packages-debian
...
[podman] copying honcho-inspector-backend_0.1.0-SNAPSHOT_all.deb -> .../dist/packages/debian
ok: honcho-inspector-backend package(s) for debian:
total 70M
drwxr-xr-x 2 mlapointe mlapointe 4.0K Jun 29 09:30 .
dr-xr-xr-x 9 mlapointe mlapointe 4.0K Jun 29 09:29 ..
-rw-r--r-- 1 mlapointe mlapointe 71M Jun 29 09:30 honcho-inspector-backend_0.1.0-SNAPSHOT_all.deb
```

### Manual path (no Makefile)

For operators who don't use the Makefile wrappers, the same flow is:

```bash
# (1) build the per-distro build image
podman build --pull=false \
    -t honcho-inspector-backend:builder-debian \
    -f packaging/build/debian/Containerfile .

# (2) run it in the background, mount /src only, give /out a named volume
podman volume create honcho-out-tmp
podman run --detach --rm --name=builder \
    --mount type=volume,source=honcho-out-tmp,destination=/out \
    -v "$(pwd)":/src:ro \
    honcho-inspector-backend:builder-debian

# (3) wait for the build to finish
podman wait builder
# or: while [ "$(podman inspect builder -f '{{.State.Status}}')" != exited ]; do sleep 2; done

# (4) extract the produced artifact (the entrypoint prints the name)
NAME=$(podman logs builder | grep '^BUILT: /out/' | sed 's|^BUILT: /out/||' | tail -n1)
mkdir -p dist/packages/debian
podman cp "builder:/out/$NAME" "dist/packages/debian/$NAME"
podman rm -f builder
podman volume rm honcho-out-tmp
```

Common artifacts (the format follows the per-distro packager's
convention, not the build-matrix):

```
honcho-inspector-backend_0.1.0-SNAPSHOT_all.deb                  # debian
honcho-inspector-backend-0.1.0-SNAPSHOT-1.noarch.rpm             # rocky / suse
honcho-inspector-backend-0.1.0-SNAPSHOT.apk                      # alpine
honcho-inspector-backend-0.1.0.SNAPSHOT-1-x86_64.pkg.tar.zst     # arch
honcho-inspector-backend-0.1.0-SNAPSHOT_1.x86_64.xbps            # void
```

### Why named volume + `cp` instead of `-v $OUT_DIR:/out:rw`?

The bind-mount pattern (`-v` a host directory into the container at
`/out`) is the textbook approach but it's broken under podman rootless:
the file lands on the host owned by some unmapped uid (typically 100999
in the default subuid range), and the host operator cannot `chown` or
`rm -rf` it without sudo. `podman unshare -- chown` is silently a
no-op on the overlay-bind combination because the bind-mount inode
ownership is re-projected through the operator's userns on every
lookup.

A podman-managed named volume lives outside the bind-mount path,
so the artifact is created by the runtime itself (which has the right
CAP_CHOWN over the operator's mapped uids). `podman cp` reads from
the volume after the container has exited and writes a fresh inode
on the host filesystem, owned by the operator. No bind-mount, no
sudo, no race.

### Smoke-test: install the artifact in a matching distro

The point of native packaging is that the package installs with the host's
package manager. Smoke-test before shipping. The per-distro directory
layout is `<repo>/dist/packages/<distro>/<artifact>`, so substitute
`dist/packages/debian` for the per-distro path you care about:

```bash
# Debian
podman run --rm -v $PWD/dist/packages/debian:/dist:ro debian:13-slim \
    bash -c 'apt update && apt install -y /dist/*.deb && \
             systemctl start honcho-inspector && \
             sleep 5 && curl -fsS http://127.0.0.1:8080/api/health'

# Rocky
podman run --rm -v $PWD/dist/packages/rocky:/dist:ro rockylinux:10-minimal \
    bash -c 'dnf install -y /dist/*.rpm && \
             systemctl start honcho-inspector && \
             sleep 5 && curl -fsS http://127.0.0.1:8080/api/health'

# (similar for suse / alpine / arch / void)
```

For Void, the smoke test is different because Void uses runit, not systemd:

```bash
podman run --rm -v $PWD/dist/packages/void:/dist:ro voidlinux/voidlinux:glibc \
    bash -c 'xbps-install -y /dist/*.xbps && \
             ln -s /etc/sv/honcho-inspector /var/service/ && \
             sv up honcho-inspector && \
             sleep 5 && curl -fsS http://127.0.0.1:8080/api/health'
```

(The build container's xbps-create invocation produces a package whose
`post_install()` script activates the right init system automatically. The
above is what would happen on a real Void install — but smoke-testing in a
container is fastest.)

## Per-distro notes

### Debian 13 (trixie)

- **Node 24** is NOT in trixie main (only Node 20). The Containerfile adds
  Nodesource's `setup_24.x` repo via the modern
  `/etc/apt/keyrings/nodesource.gpg` + `signed-by=` pattern. We do NOT use
  `apt-key` (deprecated in Debian 11, removed in Debian 12).
- **fpm** is NOT in Debian (Debian's `fpm` package is the unrelated Fortran
  project "fpm2"). The Containerfile installs fpm as a Ruby gem.
- **Java 25**: `openjdk-25-jdk-headless` is in trixie main.

### Rocky Linux 10

- **Java 25** + **Node 24** are both in AppStream. `nodejs24` is `1:24.14.1-2.el10_1`.
- The `crb` repo is enabled inside the Containerfile to satisfy `-devel`
  package builds (fpm's native extensions need `gcc`, `make`, etc.).
- The postinst is generated inside the entrypoint using shadow's
  `useradd`/`groupadd` (NOT Debian's `adduser --system`).

### openSUSE Leap 16

- **Java 25** + **Node 24** are in the **Package Hub** repo (not in main OSS).
  Package Hub is enabled by default on Leap 16. The Containerfile's repo
  configuration is the minimal one that satisfies the verified package set.
- The postinst is generated inside the entrypoint (SUSE's `zypper` doesn't
  share Debian's `adduser` semantics).

### Alpine 3.22

- **Java 25** + **Node 24** are NOT in v3.22 main. The Containerfile adds
  the `edge/community` repo at lower priority so `nodejs24` and `openjdk25`
  are reachable while still preferring v3.22 main for everything else.
- The postinst is generated inside the entrypoint (BusyBox's `adduser`
  syntax differs from shadow's; we generate the BusyBox-flavored version).

### Arch Linux

- **Java 25**: `jdk25-openjdk` + `jre25-openjdk-headless` (Arch's actual
  names; Debian-flavored names like `java-25-openjdk` do NOT exist).
- **Node 24**: `nodejs-lts-krypton` (the codename for Node 24 LTS).
- **fpm is not used.** Arch uses `makepkg` against a PKGBUILD. The PKGBUILD
  and `.INSTALL` files are generated dynamically inside the entrypoint
  (version bumps would otherwise drift in a hand-written PKGBUILD).
- `makepkg` refuses to run as root. The entrypoint creates a `build` user
  and runs `runuser -u build -- bash -c "cd ... && fakeroot makepkg ..."`.
- The artifact name follows pacman's convention with the arch suffix:
  `honcho-inspector-backend-0.1.0.SNAPSHOT-1-x86_64.pkg.tar.zst`.

### Void Linux

- **Glibc flavor**, not musl — musl has occasional symbol mismatches with
  OpenJDK's native helpers.
- The `.xbps` is built via `xbps-create`, not fpm (fpm has no Void target).
- **Both** a systemd unit AND a runit runscript tree are shipped inside the
  package. The `post_install()` script in the install-action detects which
  init system is present and activates the matching service. This is the
  `k3s` pattern from k3s-io/k3s#13349 — the operator's box may have either
  init system, and the package "just works" on both.
- The detection priority is **runit first** (Void's default), with a
  fallback to **systemd**. If neither is present, the package installs but
  the service stays inactive until the operator configures an init system.

## Why no flatpak or snap?

`honcho-inspector-backend` is a long-running multi-service admin tool:

- The backend listens on TCP ports (8080 for the API, loopback-only).
- It writes to `/var/lib/honcho-inspector` (SQLite + audit logs).
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
single-bundle alternative. It would still require designing the backend
around snap's confinement model, which is a different project.

## License

BSD-3-Clause. See `LICENSE`.