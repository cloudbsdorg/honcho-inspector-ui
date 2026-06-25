# Regression suite

End-to-end regression for the honcho-inspector build matrix. Drives 12 build
pairs (6 distros × 2 repos) through three phases:

1. **Phase 1 — build**: podman build the builder image, run it, capture the
   native package artifact in `artifacts/`.
2. **Phase 2 — smoke**: launch a runtime container from the matching distro,
   install the artifact via the distro's package manager, start the service
   (JVM for backend, `npm start` for UI), probe the health endpoint.
3. **Phase 3 — Playwright**: drive a real browser through the 9-screen
   regression (setup wizard → profile selector → profile create → dashboard →
   inspector 5 tabs → admin 4 tabs → logout → login). Screenshots per screen.

## Quickstart

```bash
# Single pair smoke test (fast — ~2 min including the mvn build):
bin/regression-test backend debian

# Full 12-pair matrix, sequential phase 2 (smoke runs concurrently):
bin/regression-test --parallel 6 --keep --resume

# Full matrix with UI Playwright runs (adds ~30-45 min):
bin/regression-test --playwright --parallel 6

# Phase-by-phase for tight iteration:
bin/regression-test --phase 1 --parallel 6          # builds only
bin/regression-test --phase 2 --parallel 6 --resume  # smoke tests
bin/regression-test --phase 3 --playwright --resume  # Playwright
```

## Outputs

```
artifacts/<repo>-<distro>.<ext>      -- built packages (10-100MB each)
logs/<timestamp>/<repo>-<distro>.log -- per-pair full transcripts
playwright/<timestamp>/<repo>-<distro>/-- screenshots + per-pair report
state.tsv                            -- per-pair pass/fail (key=repo/distro)
```

`state.tsv` is the source of truth for `--resume`. Wipe with `--clean` to
re-test everything from scratch.

## Repeatability properties

| Concern | Mitigation |
|---|---|
| Disk fills up | `check_disk()` aborts before each phase if `<5GB` free; `maybe_prune()` runs `podman system prune` if reclaimable `>2GB` |
| Half-failed runs | `state.tsv` records pass/fail; `--resume` skips done pairs |
| Cumulative cruft | `--clean` wipes logs/, artifacts/, state.tsv before run |
| Lost logs | Each run has a timestamped `logs/<ts>/`; previous runs are kept |
| Container zombies | Runtime containers are removed after each pair unless `--keep` |
| Bash-isms | All scripts validated with `/usr/bin/sh -n` and use only POSIX sh features |
| Network outages | `timeout 300` on install commands; failure logs the artifact path + last 30 lines of `svc.log` |

## Resource budget

| Phase | Time (cold cache) | Disk peak | RAM peak |
|---|---|---|---|
| Build (per pair) | 1-3 min | +1.5GB (image) | +1GB (mvn/npm) |
| Smoke (per pair) | 30-60s | +200MB (runtime image) | +1GB (JVM/ng serve) |
| Playwright (per UI pair) | 30-60s | +500MB (Chrome) | +2GB (Chrome) |
| **Full 12-pair matrix** | **30-60 min** | **~30GB transient** | **~3GB steady-state** |

With `--parallel 6`, the wall time is dominated by the slowest path (UI's
`npm ci` is the longest single step).

## Layout

```
packaging/regression/
├── bin/
│   ├── regression-test       # POSIX sh orchestrator (the main entry)
│   ├── phase1-build-one      # build a single (repo, distro) builder image
│   ├── phase2-smoke-one      # install + start + health probe
│   └── phase3-pw-one         # record Playwright target (actual browser
│                             #   work is in tests/e2e/)
├── artifacts/                # produced .deb/.rpm/.apk/.pkg.tar.zst/.xbps
├── logs/<timestamp>/          # per-run transcripts
├── playwright/<timestamp>/    # per-run Playwright outputs
└── state.tsv                  # pass/fail table; survives runs
```

## Per-distro notes

- **Debian 13 (trixie)**: smoke runtime is `debian:13-slim`; install via
  `apt-get install /tmp/<artifact>`; health `127.0.0.1:8080/api/health`.
- **Rocky 10**: `rockylinux:10-minimal`; `dnf install`; same JVM health path.
- **SUSE Leap 16**: `opensuse/leap:16.0`; `zypper install`; same.
- **Alpine 3.22**: `alpine:3.22`; `apk add --allow-untrusted`; same.
- **Arch (rolling)**: `archlinux:latest`; `pacman -U`; same.
- **Void (glibc)**: `voidlinux/voidlinux:glibc`; `xbps-install`; health probe
  is delayed 5s to let the post-install's runit activation run.

UI pairs additionally install `openjdk-25-jre-headless` (Debian), or
whatever JRE the JVM-free UI needs is NOT needed (UI is pure JS) -- but the
backend start cmd is reused by all 6 distros.

## Why the orchestrator is plain POSIX sh

The matrix is invoked by CI, by the operator's shell, and potentially from
busybox. POSIX sh is the only dialect that works in all three contexts.
We validate with `/usr/bin/sh -n` (dash-like) and avoid `${var^^}`,
`[[ ... ]]`, arrays, and any other bashism.

## License

BSD-3-Clause. See `LICENSE`.