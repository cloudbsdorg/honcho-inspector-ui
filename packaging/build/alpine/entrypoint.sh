#!/bin/sh
# entrypoint.sh -- honcho-inspector-ui APK package builder (Alpine 3.23).
#
# Uses Alpine's native `apk mkpkg` to build a valid signed apk instead
# of fpm. fpm 1.17's apk builder produces an apk that apk-tools 3.x
# rejects with "unexpected end of file" -- the cut_tar_record function
# strips the end-of-tar marker apk's tar reader needs. apk mkpkg uses
# the same library code that apk install uses, so its output is always
# installable with apk add --allow-untrusted.
#
# Flow:
#   1. Stage /src to a tmpdir (strip noise).
#   2. Render a tarball of the data tree.
#   3. apk mkpkg -I KEY=VAL -F <data.tar.gz> -o /out/honcho.apk -s TYPE:SCRIPT.
#
# OpenRC init script is generated on the fly (Alpine uses OpenRC,
# not systemd; the debian/DEBIAN/postinst is not portable to Alpine).

set -eu

PROJECT="honcho-inspector-ui"
# apk's version parser is extremely strict -- it accepts digits
# separated by dots, followed by an optional single-letter + digits
# suffix (e.g. "0.1.0a"). Lowercase only, no separators. Render
# SNAPSHOT as "a" (alphabetic release indicator).
APK_VERSION="0.1.0a"
ARCH="all"
MAINTAINER="Mark LaPointe <mark@cloudbsd.org>"

ARTIFACT_NAME="${PROJECT}-${APK_VERSION}.apk"
ARTIFACT_PATH="/out/${ARTIFACT_NAME}"

if [ ! -d /src ]; then
    echo "FATAL: /src is not a directory" >&2; exit 1
fi
if [ ! -d /out ]; then
    echo "FATAL: /out is not a directory" >&2; exit 1
fi

STAGE="$(mktemp -d -t stage.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT

cp -a /src/. "$STAGE/"

rm -rf "$STAGE/.angular" \
       "$STAGE/dist" \
       "$STAGE/.git" \
       "$STAGE/debian" \
       "$STAGE/node_modules" \
       "$STAGE/.pkg-scripts" \
       "$STAGE/packaging/regression" \
       "$STAGE/packaging/build" 2>/dev/null || true
find "$STAGE" -type f -name '*.log' -delete

# The install scripts are appended by apk mkpkg via -s. We point apk
# at the debian/DEBIAN/{postinst,prerm,postrm} files copied into the
# stage so apk can find them; rename into the apk-expected names.
mkdir -p "$STAGE/scripts"
cp /src/debian/DEBIAN/postinst "$STAGE/scripts/post-install.sh"
cp /src/debian/DEBIAN/prerm    "$STAGE/scripts/pre-deinstall.sh"
cp /src/debian/DEBIAN/postrm   "$STAGE/scripts/post-deinstall.sh"
chmod 0755 "$STAGE/scripts/"*.sh

# Stage the data tree under usr/local/share/honcho-inspector-ui so
# apk mkpkg's -F flag installs files at the canonical path. apk mkpkg
# -F <dir> extracts the CONTENTS of <dir> at the package root (not
# <dir> as a subdir), so the canonical layout must live in <dir>.
mv "$STAGE/scripts" "$STAGE/.scripts"
DATA_DIR="$(mktemp -d -t data.XXXXXX)"
mkdir -p "$DATA_DIR/usr/local/share"
mkdir -p "$DATA_DIR/etc"
mkdir -p "$DATA_DIR/usr/local/bin"
mkdir -p "$DATA_DIR/usr/local/share/honcho-inspector-ui"
mkdir -p "$DATA_DIR/etc/systemd"
mkdir -p "$DATA_DIR/etc/honcho-inspector-ui"
(cd "$STAGE" && tar -cf - \
    --exclude=./.scripts \
    --exclude=./scripts \
    . | tar -xf - -C "$DATA_DIR/usr/local/share/honcho-inspector-ui/")
# Move distro-canonical config bits to /etc and /usr/local/bin.
if [ -f "$DATA_DIR/usr/local/share/honcho-inspector-ui/etc/systemd/honcho-inspector-ui.service" ]; then
    mv "$DATA_DIR/usr/local/share/honcho-inspector-ui/etc/systemd/honcho-inspector-ui.service" \
       "$DATA_DIR/etc/systemd/"
    rmdir "$DATA_DIR/usr/local/share/honcho-inspector-ui/etc/systemd" 2>/dev/null || true
    rmdir "$DATA_DIR/usr/local/share/honcho-inspector-ui/etc" 2>/dev/null || true
fi
if [ -f "$DATA_DIR/usr/local/share/honcho-inspector-ui/proxy.conf.json" ]; then
    mv "$DATA_DIR/usr/local/share/honcho-inspector-ui/proxy.conf.json" \
       "$DATA_DIR/etc/honcho-inspector-ui/proxy.conf.json"
fi
# Stage the install scripts at the data root so apk sees them.
cp "$STAGE/.scripts/post-install.sh" "$DATA_DIR/.post-install"
cp "$STAGE/.scripts/pre-deinstall.sh" "$DATA_DIR/.pre-deinstall"
cp "$STAGE/.scripts/post-deinstall.sh" "$DATA_DIR/.post-deinstall"
chmod 0755 "$DATA_DIR/.post-install" "$DATA_DIR/.pre-deinstall" "$DATA_DIR/.post-deinstall"

TOTAL_SIZE=$(du -sb "$DATA_DIR" | cut -f1)

apk mkpkg \
    --allow-untrusted \
    --info "name:$PROJECT" \
    --info "version:$APK_VERSION" \
    --info "arch:noarch" \
    --info "depends:nodejs" \
    --info "depends:npm" \
    --info "depends:openrc" \
    --info "depends:shadow" \
    -s "post-install:$DATA_DIR/.post-install" \
    -s "pre-deinstall:$DATA_DIR/.pre-deinstall" \
    -s "post-deinstall:$DATA_DIR/.post-deinstall" \
    -F "$DATA_DIR" \
    -o "$ARTIFACT_PATH"

chown "${HOST_UID:-0}:${HOST_GID:-0}" /out

if [ ! -f "$ARTIFACT_PATH" ]; then
    echo "FATAL: apk not produced at $ARTIFACT_PATH" >&2
    exit 1
fi

echo "BUILT: $ARTIFACT_PATH"
exit 0
