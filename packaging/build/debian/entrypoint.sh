#!/bin/sh
# entrypoint.sh -- honcho-inspector-ui Debian package builder.
#
# What this script does:
#   1. Verifies the /src (read-only source tree) and /out (artifact
#      destination) bind mounts are present.
#   2. Stages /src into /tmp/stage, stripping node_modules, .angular/,
#      dist/, .git/, debian/, and any stray *.log files. The UI deb
#      intentionally ships SOURCE only -- the systemd unit's
#      ExecStartPre runs `npm ci` on first boot so the right native
#      binaries (esbuild, rollup) for the host architecture get
#      pulled automatically. That keeps Architecture: all genuine.
#   3. Copies debian/DEBIAN/{postinst,prerm,postrm,changelog} into
#      .pkg-scripts/ so fpm can reference them as relative paths
#      (fpm's --after-install / --before-remove / --after-remove
#      flags expect the script paths to be inside the source root).
#   4. Runs fpm -s dir -t deb to assemble the .deb. The file mappings
#      mirror the canonical Makefile target (`make deb`) so an
#      operator can reproduce this build locally without podman.
#   5. Copies the resulting artifact to /out and chowns it to the
#      host UID/GID via the HOST_UID/HOST_GID build args (default 0:0)
#      so the invoking user owns the file.
#
# Why re-implement the fpm invocation here rather than calling
# `make deb` from the source tree: the entrypoint is the contract.
# Each distro's builder is self-contained -- only /src is shared.
# Re-using the Makefile would force every container to ship GNU make
# and a toolchain we already get from the base image, and it would
# hide per-distro subtleties (RPM vs deb's --deb-systemd, APK's lack
# of systemd unit metadata, etc.) inside a portable abstraction.

set -eu

PROJECT="honcho-inspector-ui"
VERSION="0.1.0-SNAPSHOT"
ARCH="all"
MAINTAINER="cloudBSD <admin@cloudbsd.org>"

ARTIFACT_NAME="${PROJECT}_${VERSION}_${ARCH}.deb"
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

# Use cp -a so symlinks and perms are preserved. Trailing /. copies
# the directory contents (not the directory itself) so /tmp/stage
# looks like the project root to fpm.
cp -a /src/. "$STAGE/"

# Re-stage the debian scripts where fpm expects them. fpm's
# --after-install / --before-remove / --after-remove flags take
# paths RELATIVE to the source root; .pkg-scripts/ is just a
# scratch directory of our choosing that doesn't pollute the actual
# source layout. The chmod 0755 makes dpkg happy when it tries to
# exec them post-install.
mkdir -p "$STAGE/.pkg-scripts"
cp /src/debian/DEBIAN/postinst    "$STAGE/.pkg-scripts/postinst"
cp /src/debian/DEBIAN/prerm       "$STAGE/.pkg-scripts/prerm"
cp /src/debian/DEBIAN/postrm      "$STAGE/.pkg-scripts/postrm"
cp /src/debian/DEBIAN/changelog   "$STAGE/.pkg-scripts/changelog"
chmod 0755 "$STAGE/.pkg-scripts/postinst" \
          "$STAGE/.pkg-scripts/prerm" \
          "$STAGE/.pkg-scripts/postrm"

# Strip noise. node_modules and .angular are huge; dist is the
# pre-built artifact (irrelevant for a source-only deb). .git and
# debian/ are staging-only. *.log is incidental.
rm -rf "$STAGE/.angular" \
       "$STAGE/dist" \
       "$STAGE/.git" \
       "$STAGE/debian" \
       "$STAGE/node_modules"
find "$STAGE" -type f -name '*.log' -delete

# --- 2. Build the .deb via fpm -----------------------------------
# Mirror of the Makefile's `deb` target. The directory mappings are
#   .   -> /usr/local/share/honcho-inspector-ui (the source tree)
#   proxy.conf.json
#       -> /etc/honcho-inspector-ui/proxy.conf.json (conffile; shipped
#          once and respected on subsequent upgrades)
#   packaging/container/entrypoint.sh
#       -> /usr/local/bin/entrypoint.sh (runtime image entrypoint,
#          also useful from the deb for manual `systemctl start` debugging)
#   .pkg-scripts/changelog
#       -> /usr/local/share/doc/honcho-inspector-ui/changelog.Debian
#
# --deb-systemd + --deb-systemd-path drops the unit into
# /etc/systemd/system on install and emits a debhelper-style
# maintainer-script fragment that runs `systemctl enable + try-restart`
# after install/upgrade. Our postinst does the same explicitly so
# the unit is reloaded even on distros where fpm's auto-fragment
# doesn't run (Alpine, Arch with makepkg, etc.).
cd "$STAGE"
fpm -s dir -t deb \
    -p "$ARTIFACT_PATH" \
    -n "$PROJECT" \
    -v "$VERSION" \
    -a "$ARCH" \
    --maintainer "$MAINTAINER" \
    --description "Honcho Inspector UI (Angular 22 dashboard). Runs ng serve as a node app under systemd, bound on 0.0.0.0:4200. node_modules is NOT shipped -- the systemd unit runs 'npm ci' as ExecStartPre on first boot so the right native binaries for the host arch get pulled automatically." \
    --depends "nodejs (>= 20)" \
    --depends npm \
    --depends adduser \
    --deb-no-default-config-files \
    --deb-systemd etc/systemd/honcho-inspector-ui.service \
    --deb-systemd-path etc/systemd/system \
    --after-install  .pkg-scripts/postinst \
    --before-remove  .pkg-scripts/prerm \
    --after-remove   .pkg-scripts/postrm \
    .=/usr/local/share/honcho-inspector-ui \
    proxy.conf.json=/etc/honcho-inspector-ui/proxy.conf.json \
    packaging/container/entrypoint.sh=/usr/local/bin/entrypoint.sh \
    .pkg-scripts/changelog=/usr/local/share/doc/honcho-inspector-ui/changelog.Debian

# --- 3. Hand the artifact to the host ---------------------------
# fpm wrote to /out (because -p is an absolute path), but the file
# mode / ownership reflect the container's uid. Re-chown to the
# HOST_UID/HOST_GID the user passed via --env so the .deb is owned
# by the invoking shell user, not root.
chown -R "${HOST_UID:-0}:${HOST_GID:-0}" /out

if [ ! -f "$ARTIFACT_PATH" ]; then
    echo "FATAL: fpm reported success but $ARTIFACT_PATH is missing" >&2
    exit 1
fi

echo "BUILT: $ARTIFACT_PATH"
exit 0
