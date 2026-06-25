#!/bin/sh
# entrypoint.sh -- honcho-inspector-ui RPM package builder (Rocky 10).
#
# Same overall flow as the Debian entrypoint: verify mounts, stage
# /src into /tmp/stage (stripping node_modules / .angular / dist /
# .git / debian / *.log), copy debian/DEBIAN/{postinst,prerm,postrm,
# changelog} into .pkg-scripts/, run fpm, copy artifact to /out,
# chown to HOST_UID/HOST_GID. See debian/entrypoint.sh for the
# generic-stage commentary; this file only documents the RPM-
# specific fpm invocation and the noarch-vs-arch rationale.
#
# RPM-specific notes:
#   - -a noarch  (not -a all -- RPM has its own `noarch` keyword
#     meaning "no machine code in this package, safe for every arch")
#   - --rpm-os linux (so the rpm's OS string is "linux" instead of
#     the build container's "rocky" -- matches the convention other
#     noarch RPMs in the wild use)
#   - --rpm-digest sha256 (modern default; Rocky 10's rpmbuild
#     refuses SHA1-signed rpms on install)
#   - The systemd unit is installed as a regular file mapping
#     (etc/systemd/honcho-inspector-ui.service=/etc/systemd/system/...)
#     rather than via --deb-systemd (which is deb-only). The postinst
#     handles `systemctl daemon-reload + enable + restart` itself.

set -eu

PROJECT="honcho-inspector-ui"
VERSION="0.1.0-SNAPSHOT"
RELEASE="1"
ARCH="noarch"
MAINTAINER="cloudBSD <admin@cloudbsd.org>"

ARTIFACT_NAME="${PROJECT}-${VERSION}-${RELEASE}.${ARCH}.rpm"
ARTIFACT_PATH="/out/${ARTIFACT_NAME}"

# --- 0. Sanity-check the bind mounts ----------------------------
if [ ! -d /src ]; then
    echo "FATAL: /src is not a directory -- did you forget -v \$PWD:/src:ro ?" >&2
    exit 1
fi
if [ ! -d /out ]; then
    echo "FATAL: /out is not a directory -- did you forget -v \$PWD/../dist:/out:rw ?" >&2
    exit 1
fi
if [ ! -f /src/debian/DEBIAN/control ]; then
    echo "FATAL: /src/debian/DEBIAN/control missing -- is /src the honcho-inspector-ui repo root ?" >&2
    exit 1
fi

# --- 1. Stage the source tree ------------------------------------
STAGE="$(mktemp -d -t stage.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT

cp -a /src/. "$STAGE/"

mkdir -p "$STAGE/.pkg-scripts"
cp /src/debian/DEBIAN/postinst  "$STAGE/.pkg-scripts/postinst"
cp /src/debian/DEBIAN/prerm     "$STAGE/.pkg-scripts/prerm"
cp /src/debian/DEBIAN/postrm    "$STAGE/.pkg-scripts/postrm"
cp /src/debian/DEBIAN/changelog "$STAGE/.pkg-scripts/changelog"
chmod 0755 "$STAGE/.pkg-scripts/postinst" \
          "$STAGE/.pkg-scripts/prerm" \
          "$STAGE/.pkg-scripts/postrm"

# Strip noise.
rm -rf "$STAGE/.angular" \
       "$STAGE/dist" \
       "$STAGE/.git" \
       "$STAGE/debian" \
       "$STAGE/node_modules"
find "$STAGE" -type f -name '*.log' -delete

# --- 2. Build the .rpm via fpm -----------------------------------
# fpm's RPM backend shells out to rpmbuild. The actual file layout
# in the rpm is determined by the source=dest mappings; the systemd
# unit ends up at /etc/systemd/system/honcho-inspector-ui.service,
# the source tree at /usr/local/share/honcho-inspector-ui, and the
# runtime entrypoint at /usr/local/bin/entrypoint.sh (handy for
# debugging via `sudo -u www-data /usr/local/bin/entrypoint.sh`).
#
# Dependencies on Rocky: the debian postinst uses `adduser` (busybox
# syntax), but Rocky's shadow-utils provides the `useradd` /
# `groupadd` pair. We list `shadow-utils` as a Requires so the
# service-account creation step has the binary it needs; the
# postinst script in /src still uses the debian-flavored adduser
# because the upstream maintainers chose that contract -- operators
# who need a Rocky-friendly postinst can override it after install.
cd "$STAGE"
fpm -s dir -t rpm \
    -p "$ARTIFACT_PATH" \
    -n "$PROJECT" \
    -v "$VERSION" \
    --iteration "$RELEASE" \
    -a "$ARCH" \
    --maintainer "$MAINTAINER" \
    --description "Honcho Inspector UI (Angular 22 dashboard). Runs ng serve as a node app under systemd, bound on 0.0.0.0:4200. node_modules is NOT shipped -- the systemd unit runs 'npm ci' as ExecStartPre on first boot so the right native binaries for the host arch get pulled automatically." \
    --url "https://github.com/cloudbsdorg/honcho-inspector-ui" \
    --license "BSD-3-Clause" \
    --depends "nodejs >= 20" \
    --depends "npm" \
    --depends "shadow-utils" \
    --rpm-os linux \
    --rpm-digest sha256 \
    --after-install  .pkg-scripts/postinst \
    --before-remove  .pkg-scripts/prerm \
    --after-remove   .pkg-scripts/postrm \
    .=/usr/local/share/honcho-inspector-ui \
    proxy.conf.json=/etc/honcho-inspector-ui/proxy.conf.json \
    packaging/container/entrypoint.sh=/usr/local/bin/entrypoint.sh \
    etc/systemd/honcho-inspector-ui.service=/etc/systemd/system/honcho-inspector-ui.service \
    .pkg-scripts/changelog=/usr/local/share/doc/honcho-inspector-ui/changelog.Debian

# --- 3. Hand the artifact to the host ---------------------------
chown -R "${HOST_UID:-0}:${HOST_GID:-0}" /out

if [ ! -f "$ARTIFACT_PATH" ]; then
    echo "FATAL: fpm reported success but $ARTIFACT_PATH is missing" >&2
    exit 1
fi

echo "BUILT: $ARTIFACT_PATH"
exit 0
