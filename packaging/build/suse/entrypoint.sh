#!/bin/sh
# entrypoint.sh -- honcho-inspector-ui RPM package builder (openSUSE Leap 16).
#
# Same flow as the Rocky 10 entrypoint: verify mounts, stage /src
# into /tmp/stage (strip node_modules / .angular / dist / .git /
# debian / *.log), copy debian/DEBIAN/{postinst,prerm,postrm,
# changelog} into .pkg-scripts/, run fpm -s dir -t rpm, copy
# artifact to /out, chown to HOST_UID/HOST_GID.
#
# SUSE-specific notes:
#   - The Containerfile enables Package Hub so nodejs24 is visible;
#     no other SUSE-specific tweaks are needed inside the entrypoint.
#   - fpm produces a noarch rpm identical in name and layout to the
#     Rocky 10 build, so the same install path works on both
#     distros. SUSE's `zypper install ./honcho-inspector-ui-*.rpm`
#     honors the Requires, postinst, and prerm exactly as Rocky does.
#   - --rpm-os linux is kept (same convention as Rocky); SUSE's
#     rpm tooling accepts "linux" without complaint.
#   - shadow-utils equivalent on SUSE is `shadow` (we depend on it
#     via fpm --depends so the postinst's useradd invocation has
#     the binary it needs).

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
# The fpm invocation is identical to the Rocky 10 build (same
# upstream fpm and same rpmbuild backend). We depend on `shadow`
# (SUSE's name for the shadow-utils package) so the postinst's
# adduser/addgroup calls have the binaries they need.
cd "$STAGE"
mkdir -p var/lib/honcho-inspector-ui var/log/honcho-inspector-ui etc/honcho-inspector-ui
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
    --depends "shadow" \
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
