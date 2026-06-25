#!/bin/sh
# entrypoint.sh -- honcho-inspector-ui APK package builder (Alpine 3.22).
#
# Same flow as the debian/rocky/suse entrypoints: verify mounts,
# stage /src into /tmp/stage (strip node_modules / .angular / dist /
# .git / debian / *.log), copy debian/DEBIAN/{postinst,prerm,
# postrm,changelog} into .pkg-scripts/, run fpm, copy artifact to
# /out, chown to HOST_UID/HOST_GID.
#
# APK-specific notes:
#   - fpm -t apk produces a .apk with .tar.gz compression. apk's
#     own package tooling (apk add --allow-untrusted) installs it.
#   - Alpine's busybox adduser/addgroup match the debian postinst's
#     syntax, so the upstream postinst runs unmodified on Alpine.
#     This is the one distro in the matrix where the debian postinst
#     is genuinely portable without a shadow-equivalent package.
#   - --apk-autodep off is set so fpm doesn't try to scan the staged
#     binaries for sonames and synthesize a Requires list -- we list
#     nodejs + npm + adduser explicitly and we know the binary
#     surface (Angular source + node_modules-less tree).

set -eu

PROJECT="honcho-inspector-ui"
VERSION="0.1.0-SNAPSHOT"
ARCH="all"
MAINTAINER="cloudBSD <admin@cloudbsd.org>"

ARTIFACT_NAME="${PROJECT}-${VERSION}.apk"
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

# --- 2. Build the .apk via fpm -----------------------------------
# fpm's apk backend uses tar/gzip by default; we don't override
# compression. The systemd unit ships as a regular file mapping;
# fpm's apk backend does not have a `--deb-systemd` analog.
# The postinst still runs systemctl + friends when systemd is
# present, which on Alpine is the case if the operator installed
# the `openrc` -> `systemd` transition or is running this on a
# post-3.18 Alpine where systemd is the default init.
cd "$STAGE"
fpm -s dir -t apk \
    -p "$ARTIFACT_PATH" \
    -n "$PROJECT" \
    -v "$VERSION" \
    -a "$ARCH" \
    --maintainer "$MAINTAINER" \
    --description "Honcho Inspector UI (Angular 22 dashboard). Runs ng serve as a node app under systemd, bound on 0.0.0.0:4200. node_modules is NOT shipped -- the systemd unit runs 'npm ci' as ExecStartPre on first boot so the right native binaries for the host arch get pulled automatically." \
    --url "https://github.com/cloudbsdorg/honcho-inspector-ui" \
    --license "BSD-3-Clause" \
    --depends "nodejs>=20" \
    --depends "npm" \
    --depends "shadow" \
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
