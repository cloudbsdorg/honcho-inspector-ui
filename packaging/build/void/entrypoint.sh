#!/bin/sh
# entrypoint.sh -- honcho-inspector-ui xbps package builder (Void Linux).
#
# Same overall flow as the fpm-based builds, with three material
# differences:
#
#   1. NO fpm. xbps-create is the build tool. We do not pass file
#      mappings via command-line flags -- xbps-create treats the
#      staged directory as a mini-filesystem (relative paths
#      become install paths). So the entrypoint MOVES files in
#      /tmp/stage to the canonical install paths (etc/systemd/...,
#      etc/sv/..., usr/local/bin/, etc/honcho-inspector-ui/, ...)
#      before invoking xbps-create.
#
#   2. The runscript tree is generated here. Void's runtime is
#      runit, so /etc/sv/honcho-inspector-ui/{run,log/run} ships
#      with the package. The systemd unit is still bundled (for
#      host distros that happen to install the xbps with systemd
#      present), but Void's INSTALL script defaults to the runit
#      path.
#
#   3. xbps-create consumes an INSTALL script via --install-script;
#      the script is a SEPARATE file (not in the stage tree). It
#      uses bash-style function hooks (post_install, pre_remove,
#      post_remove). xbps-create reads the script at build time
#      and embeds it in the .xbps metadata -- it does not land
#      in the package's filesystem payload.

set -eu

PROJECT="honcho-inspector-ui"
# xbps versions allow letters, numbers, dots, dashes, underscores.
# 0.1.0-SNAPSHOT_1 keeps the upstream Debian-style version (with
# `-`) and adds xbps's mandatory `_1` revision suffix.
VERSION="0.1.0-SNAPSHOT_1"
# xbps-create's pkgver parser only allows [a-z0-9_.~] in the
# version component. Our Maven version has `-SNAPSHOT` which is
# rejected. Replace `-` with `~` (Debian's pre-release convention,
# also valid in xbps pkgvers) so the generated pkgver is well-formed.
# Done with tr (not bash parameter expansion) because Void's
# /bin/sh is dash, not bash.
XBPS_VERSION="$(printf '%s' "${VERSION}" | tr '-' '~')"
ARCH="x86_64"
ARTIFACT_NAME="${PROJECT}-${XBPS_VERSION}.${ARCH}.xbps"
ARTIFACT_PATH="/out/${ARTIFACT_NAME}"
MAINTAINER="cloudBSD <admin@cloudbsd.org>"
MAINTAINER_EMAIL="admin@cloudbsd.org"

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

# --- 2. Move files to their canonical install paths -------------
# xbps-create treats /tmp/stage as the install root: a file at
# /tmp/stage/usr/local/bin/foo lands at /usr/local/bin/foo after
# install. So we rearrange the staged files into the layout we
# want before invoking xbps-create.

# systemd unit -> /etc/systemd/system
mkdir -p "$STAGE/etc/systemd/system"
if [ -f "$STAGE/etc/systemd/honcho-inspector-ui.service" ]; then
    mv "$STAGE/etc/systemd/honcho-inspector-ui.service" \
       "$STAGE/etc/systemd/system/honcho-inspector-ui.service"
    rmdir "$STAGE/etc/systemd" 2>/dev/null || true
fi

# Runtime entrypoint -> /usr/local/bin
mkdir -p "$STAGE/usr/local/bin"
mv "$STAGE/packaging/container/entrypoint.sh" \
   "$STAGE/usr/local/bin/entrypoint.sh"

# proxy.conf.json -> /etc/honcho-inspector-ui (treated as a conffile
# by xbps -- any file under etc/ in the stage is automatically a
# conffile).
mkdir -p "$STAGE/etc/honcho-inspector-ui"
mv "$STAGE/proxy.conf.json" \
   "$STAGE/etc/honcho-inspector-ui/proxy.conf.json"

# Changelog -> /usr/local/share/doc/honcho-inspector-ui
mkdir -p "$STAGE/usr/local/share/doc/honcho-inspector-ui"
mv "$STAGE/.pkg-scripts/changelog" \
   "$STAGE/usr/local/share/doc/honcho-inspector-ui/changelog.Debian"
rm -rf "$STAGE/.pkg-scripts"

# --- 3. Generate runit runscript tree ----------------------------
# Void's runtime is runit; /etc/sv/<name>/run is the supervisor
# script, /etc/sv/<name>/log/run is the log pipeline. We ship both.
# The runscript re-implements the systemd unit's ExecStartPre
# (idempotent `npm ci --omit=dev` on first boot) and ExecStart
# (npx ng serve) using runit's toolset (chpst for setuid, svlogd
# for log rotation). The INSTALL script in step 4 symlinks this
# directory into /var/service so runsvdir picks it up.
mkdir -p "$STAGE/etc/sv/honcho-inspector-ui/log"
cat > "$STAGE/etc/sv/honcho-inspector-ui/run" <<'RUN_EOF'
#!/bin/sh
# runit runscript for honcho-inspector-ui.
# Mirrors the systemd unit's ExecStartPre + ExecStart semantics:
#   - On first boot, install production node_modules via
#     `npm ci --omit=dev` (idempotent; subsequent runs are no-ops).
#   - Then exec `ng serve` under www-data via chpst.
exec 2>&1
cd /usr/local/share/honcho-inspector-ui
if [ ! -d node_modules ]; then
    chpst -u www-data /usr/bin/env npm ci --omit=dev --no-audit --no-fund
fi
exec chpst -u www-data /usr/bin/env node node_modules/.bin/ng serve \
    --host 0.0.0.0 \
    --port 4200 \
    --proxy-config /etc/honcho-inspector-ui/proxy.conf.json \
    --watch=false
RUN_EOF
chmod 0755 "$STAGE/etc/sv/honcho-inspector-ui/run"

cat > "$STAGE/etc/sv/honcho-inspector-ui/log/run" <<'LOG_EOF'
#!/bin/sh
# runit log pipeline for honcho-inspector-ui. svlogd writes to
# /var/log/honcho-inspector-ui/ with timestamp + rotation; the
# post_install hook in INSTALL creates that directory as
# root:www-data mode 0770.
exec chpst -u www-data svlogd -tt /var/log/honcho-inspector-ui
LOG_EOF
chmod 0755 "$STAGE/etc/sv/honcho-inspector-ui/log/run"

# --- 4. Write the INSTALL script ---------------------------------
# xbps-create's --install-script reads a bash script with hooks
# (post_install / pre_remove / post_remove). The hook body mirrors
# the debian postinst but adapts to Void's useradd / groupadd
# semantics AND detects whether the host is running runit or
# systemd. We default to runit (Void's native init) when both are
# present (an unlikely edge case but cheap to handle).
INSTALL_SCRIPT="$(mktemp -t xbps-install.XXXXXX.sh)"
trap 'rm -rf "$STAGE" "$INSTALL_SCRIPT"' EXIT

cat > "$INSTALL_SCRIPT" <<'INSTALL_EOF'
#!/bin/bash
# xbps INSTALL script for honcho-inspector-ui.
# Generated by packaging/build/void/entrypoint.sh. Hook functions
# follow xbps-create(1) conventions; xbps calls them at the right
# phase of the install/upgrade/remove transaction.

post_install() {
    # Service account. Void's shadow provides useradd/groupadd;
    # the debian-flavored `adduser --system` is not present.
    # Idempotent: skip if already present.
    if ! getent group www-data >/dev/null; then
        groupadd www-data
    fi
    if ! getent passwd www-data >/dev/null; then
        useradd -d /var/lib/honcho-inspector-ui \
            -s /sbin/nologin \
            -g www-data \
            -c "Honcho Inspector UI service account" \
            www-data
    fi

    # State, log, config dirs. 0770 lets www-data land the npm
    # cache under /var/lib on the first boot's `npm ci` (called
    # from the runit runscript).
    install -d -m 0770 -o root -g www-data /var/lib/honcho-inspector-ui
    install -d -m 0770 -o root -g www-data /var/log/honcho-inspector-ui
    install -d -m 0750 -o root -g www-data /etc/honcho-inspector-ui

    chown -R root:www-data /usr/local/share/honcho-inspector-ui
    find /usr/local/share/honcho-inspector-ui -type d -exec chmod 0775 {} +

    # Seed proxy.conf.json only if missing -- xbps treats
    # /etc/* files as conffiles and will not overwrite on
    # upgrade, but a fresh install has no file at all.
    if [ ! -f /etc/honcho-inspector-ui/proxy.conf.json ]; then
        install -m 0644 -o root -g www-data \
            /usr/local/share/honcho-inspector-ui/proxy.conf.json \
            /etc/honcho-inspector-ui/proxy.conf.json
    fi

    # Activate the appropriate init system. Void defaults to
    # runit; if systemd is live (operator installed the xbps on
    # a systemd host), use that path instead.
    if [ -d /run/runit ] || [ -e /var/service ] || [ -e /etc/runit ]; then
        # runit: symlink the runscript into /var/service and ask
        # runsvdir to start it. We tolerate a missing supervisor
        # (e.g. chroot / recovery install).
        install -d /var/service
        ln -sf /etc/sv/honcho-inspector-ui /var/service/honcho-inspector-ui
        sv start honcho-inspector-ui 2>/dev/null || true
    elif [ -d /run/systemd/system ]; then
        systemctl daemon-reload
        systemctl enable honcho-inspector-ui.service
        systemctl restart honcho-inspector-ui.service || true
    fi
}

pre_remove() {
    # Tear down whichever supervisor is live. Order matters: stop
    # first, then drop the symlink/unit, so we don't leave a
    # half-running service behind.
    if [ -L /var/service/honcho-inspector-ui ]; then
        sv stop honcho-inspector-ui 2>/dev/null || true
        rm -f /var/service/honcho-inspector-ui
    fi
    if [ -d /run/systemd/system ]; then
        systemctl stop honcho-inspector-ui.service || true
        systemctl disable honcho-inspector-ui.service || true
    fi
}

post_remove() {
    true
}
INSTALL_EOF
chmod 0644 "$INSTALL_SCRIPT"

# --- 5. Build the .xbps ------------------------------------------
# xbps-create treats /tmp/stage as the install root: every file
# under /tmp/stage/usr/local/bin/entrypoint.sh, for example,
# ends up at /usr/local/bin/entrypoint.sh after install. xbps
# automatically treats anything under etc/ as a conffile.
#
# Dependencies: nodejs>=20 (Angular CLI minimum), npm (for
# ExecStartPre / runit's first-boot `npm ci`), shadow (for
# useradd/groupadd in post_install), runit (for chpst/svlogd in
# the runscript).
#
# xbps-create in this Void release (0.60.x) does not accept
# --install-script; the install-action script is embedded via
# the staging dir at <staging>/INSTALL. Copy the generated
# script into the stage before invoking xbps-create.
cp "$INSTALL_SCRIPT" "$STAGE/INSTALL"

# --- 4b. Move remaining source files under canonical prefix ------
# Anything still at the $STAGE root after step 2 is the Angular
# source tree (package.json, src/, etc/). xbps-create installs
# $STAGE as the root filesystem, so those files would land at
# /package.json, /src/, etc. instead of under
# /usr/local/share/honcho-inspector-ui/. Move everything else into
# the canonical prefix before xbps-create runs.
mkdir -p "$STAGE/usr/local/share/honcho-inspector-ui"
for item in $(ls -A "$STAGE" 2>/dev/null); do
    case "$item" in
        INSTALL|usr|etc) continue ;;
    esac
    mv "$STAGE/$item" "$STAGE/usr/local/share/honcho-inspector-ui/"
done
# xbps-create takes pkgver as a SINGLE -n arg of the form
# name-version_revision (no spaces). We build it from NAME, XBPS_VERSION,
# and a hardcoded _1 revision. No -o flag exists in xbps-create;
# the artifact lands in $PWD with the pkgver-driven filename, then
# we move it to ARTIFACT_PATH. No --config-files: xbps <= 0.60.x has
# a bug where it stores the conf file's BUILD-TIME path in
# props.plist's conf_files key, breaking local-repo install. The
# `/etc/default/honcho-inspector-ui` env file is therefore a
# regular file (operator must back up edits before upgrade; the
# install script seeds a fresh one if missing).
cd "$(dirname "$ARTIFACT_PATH")"
xbps-create \
    -A "$ARCH" \
    -n "${PROJECT}-${XBPS_VERSION}" \
    -s "Honcho Inspector UI (Angular 22 dashboard) for Void Linux" \
    -l "BSD-3-Clause" \
    -m "$MAINTAINER <$MAINTAINER_EMAIL>" \
    -D "nodejs>=20,npm,shadow,runit" \
    --homepage "https://github.com/cloudbsdorg/honcho-inspector-ui" \
    --long-desc "Honcho Inspector UI (Angular 22 dashboard). Runs ng serve as a node app under runit (Void's default) or systemd, bound on 0.0.0.0:4200. node_modules is NOT shipped -- the runscript / systemd unit runs 'npm ci' as a first-boot step so the right native binaries (esbuild, rollup) for the host architecture get pulled automatically. This keeps the package architecture-independent." \
    --tags "angular dashboard honcho web ui" \
    "$STAGE"

XBPS_FILE="${PROJECT}-${XBPS_VERSION}.${ARCH}.xbps"
if [ ! -f "${XBPS_FILE}" ]; then
    echo "FATAL: xbps-create did not produce ${XBPS_FILE}" >&2
    exit 1
fi
if [ "${XBPS_FILE}" != "$(basename "${ARTIFACT_PATH}")" ]; then
    mv -f "${XBPS_FILE}" "$(basename "${ARTIFACT_PATH}")"
fi
cd /

# --- 6. Hand the artifact to the host ---------------------------
chown -R "${HOST_UID:-0}:${HOST_GID:-0}" /out

if [ ! -f "$ARTIFACT_PATH" ]; then
    echo "FATAL: xbps-create reported success but $ARTIFACT_PATH is missing" >&2
    exit 1
fi

echo "BUILT: $ARTIFACT_PATH"
exit 0
