#!/bin/sh
# packaging/scripts/build-package.sh
#
# Build a native Linux package for one distribution, by running the
# per-distro build container against the current source tree. The
# container reads the source tree from /src (bind-mounted read-only
# from the project root) and writes the resulting .deb / .rpm /
# .apk / .pkg.tar.zst / .xbps to an internal /out path. After the
# container exits we copy the artifact from /out to the host-side
# <repo>/dist/packages/<distro>/ directory using `podman cp` /
# `docker cp`, which writes the file with the operator's ownership.
#
# Why we don't bind-mount /out from the host:
#
# Bind-mounting the host-side output dir into the container is the
# textbook approach, but it interacts poorly with podman rootless:
# the file lands on the host owned by some unmapped uid (typically
# 100999 on a default subuid range), and the host operator cannot
# `chown` or `rm -rf` the file without sudo. `podman unshare -- chown`
# is silently a no-op on this overlay-bind combination. Using
# `podman cp` to extract the artifact post-run avoids the bind-mount
# userns round-trip entirely: the cp creates the file fresh on the
# host filesystem, owned by the running operator.
#
# docker rootful, podman rootful, docker rootless all skip the
# bind-mount altogether via the same `cp` step.
#
# Usage:
#   packaging/scripts/build-package.sh <repo-name> <distro>
#     repo-name: e.g. honcho-inspector-backend or honcho-inspector-ui
#     distro:    one of: debian rocky suse alpine arch void
#
# Exit codes:
#   0   package built and written
#   1   runtime not found (neither podman nor docker is in PATH)
#   2   distro not in the supported set
#   3   the host's source tree is not present (wrong cwd?)
#   4   the container build failed (see the build log)
#   5   the container run failed (see the run log)
#   6   the entrypoint did not produce a buildable artifact

set -eu

# === Arguments ===
REPO_NAME="${1:-}"
DISTRO="${2:-}"

# === Distro allow-list ===
# Keep this in sync with the actual subdirs under packaging/build/.
# Adding a new distro means: drop a Containerfile + entrypoint.sh
# into packaging/build/<newdistro>/ and add the name here.
SUPPORTED_DISTROS="debian rocky suse alpine arch void"

case "$DISTRO" in
    "") printf "usage: %s <repo-name> <distro>\n" "$0" >&2
        printf "supported distros: %s\n" "$SUPPORTED_DISTROS" >&2
        exit 2 ;;
    debian|rocky|suse|alpine|arch|void) ;;
    *) printf "unknown distro: %s (supported: %s)\n" "$DISTRO" "$SUPPORTED_DISTROS" >&2; exit 2 ;;
esac

case "$REPO_NAME" in
    "") printf "usage: %s <repo-name> <distro>\n" "$0" >&2; exit 2 ;;
    honcho-inspector-backend|honcho-inspector-ui) ;;
    *) printf "unknown repo-name: %s (supported: honcho-inspector-backend, honcho-inspector-ui)\n" "$REPO_NAME" >&2; exit 2 ;;
esac

# === Resolve runtime ===
# podman is preferred (rootless, no daemon). docker is the fallback.
# If neither is installed, print a clear install hint and bail.
RUNTIME=""
if command -v podman >/dev/null 2>&1; then
    RUNTIME=podman
elif command -v docker >/dev/null 2>&1; then
    RUNTIME=docker
else
    printf "no container runtime found -- install podman (preferred) or docker\n" >&2
    printf "  RHEL/Rocky:    sudo dnf install -y podman\n" >&2
    printf "  Debian/Ubuntu: sudo apt install -y podman\n" >&2
    printf "  Alpine:        sudo apk add podman\n" >&2
    exit 1
fi

# === Paths ===
# Assumes the script is at packaging/scripts/build-package.sh and
# is invoked from anywhere. Resolve the project root as the parent
# of the script's grandparent directory.
SCRIPT_DIR=`cd "\`dirname \"$0\"\`" && pwd`
PROJECT_ROOT=`cd "$SCRIPT_DIR/../.." && pwd`
DOCKERFILE="$PROJECT_ROOT/packaging/build/$DISTRO/Containerfile"
OUT_DIR="$PROJECT_ROOT/dist/packages/$DISTRO"
IMAGE_TAG="$REPO_NAME:builder-$DISTRO"

# === Pre-flight ===
# Verify the Containerfile exists. If it doesn't, the packaging
# tree is broken and we should not silently succeed.
if [ ! -f "$DOCKERFILE" ]; then
    printf "no Containerfile at %s\n" "$DOCKERFILE" >&2
    exit 2
fi

# === Output dir ===
# Per-distro subdir keeps the UI's `ng build` dist (which lands at
# dist/honcho-inspector-ui/) from colliding with the Linux package
# artifacts. The mkdir is owned by the operator (we're running as
# mlapointe), so the cp'd file lands in a directory we can chown
# and rm afterward.
mkdir -p "$OUT_DIR"
printf "output dir: %s\n" "$OUT_DIR"

# === Build the image (only if not cached) ===
# `build` is a no-op when the image already exists. To pick up
# Containerfile / entrypoint changes without a manual `rmi`, we
# use `build --pull=false` (avoid hitting the network every time)
# and rely on the build cache invalidation that the runtime does
# automatically when the Containerfile changes.
#
# Pass the host UID/GID as Containerfile build args so the entrypoint
# can chown the artifact to the operator at the end.
HOST_UID=`id -u`
HOST_GID=`id -g`
printf "[%s] building image %s ...\n" "$RUNTIME" "$IMAGE_TAG"
"$RUNTIME" build \
    --pull=false \
    --build-arg "HOST_UID=$HOST_UID" \
    --build-arg "HOST_GID=$HOST_GID" \
    -f "$DOCKERFILE" \
    -t "$IMAGE_TAG" \
    "$PROJECT_ROOT" >/dev/null || {
        printf "image build failed for %s -- run without /dev/null to see the build log\n" "$DISTRO" >&2
        exit 4
    }

# === Run the image ===
# Bind mounts:
#   $PROJECT_ROOT  -> /src  (read-only; the build reads the source tree)
#
# /out is a podman-managed named volume (NOT a bind mount from the
# host). The named volume survives after the container exits so
# `podman cp` / `docker cp` can read the artifact and write it to
# <repo>/dist/packages/<distro>/ with the operator's ownership.
#
# Why a named volume instead of `-v $OUT_DIR:/out:rw`:
# Bind-mounting the host dir into the container is the textbook
# pattern, but it interacts badly with podman rootless: the
# container's `chown 1000:1000 /out` lands on the host as some
# unmapped uid (often 100999) because the bind-mount inodes are
# re-projected through the operator's userns. The host operator
# cannot chown or rm the result without sudo, and `podman unshare
# -- chown` is silently a no-op on the overlay-bind combination.
# A podman-managed named volume lives in $GRAPHROOT/volumes/<name>/_data;
# pods/containers can share it; it survives container exit; and
# `podman cp` reads from it as the runtime's own privilege (which
# has CAP_CHOWN for the operator's mapped uids), so the file on
# the host ends up owned by the operator.
#
# HOST_UID / HOST_GID are forwarded so the entrypoint's `chown -R
# ${HOST_UID}:${HOST_GID} /out` (used in the legacy bind-mount path)
# succeeds under `set -u`. Under the named-volume + cp flow this
# chown is dead code (the artifact is in the volume, not bind-mounted),
# but we keep the env so the entrypoint doesn't crash with
# "HOST_UID: unbound variable".
CONTAINER_NAME="${REPO_NAME}-builder-${DISTRO}-$$"
VOLUME_NAME="${REPO_NAME}-out-${DISTRO}-$$"
printf "[%s] preparing volume %s\n" "$RUNTIME" "$VOLUME_NAME"
"$RUNTIME" volume create "$VOLUME_NAME" >/dev/null 2>&1 || true

printf "[%s] running %s (detached as %s) ...\n" "$RUNTIME" "$IMAGE_TAG" "$CONTAINER_NAME"
"$RUNTIME" run --detach \
    --name "$CONTAINER_NAME" \
    --env "HOST_UID=$HOST_UID" \
    --env "HOST_GID=$HOST_GID" \
    --mount "type=volume,source=$VOLUME_NAME,destination=/out" \
    -v "$PROJECT_ROOT:/src:ro" \
    "$IMAGE_TAG" || {
        printf "container start failed for %s\n" "$DISTRO" >&2
        "$RUNTIME" volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
        exit 5
    }

# Wait for the build to finish. The entrypoint script causes
# the container to exit with code 0 on success; we poll for
# the exited state and then extract.
printf "[%s] waiting for build to finish ...\n" "$RUNTIME"
ATTEMPTS=0
MAX_ATTEMPTS=600   # 600 * 2s = 1200s = 20min; the longest distro is alpine cold-cache
while [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
    STATUS=`"$RUNTIME" inspect --format '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo unknown`
    case "$STATUS" in
        exited)
            EXIT_CODE=`"$RUNTIME" inspect --format '{{.State.ExitCode}}' "$CONTAINER_NAME" 2>/dev/null || echo 1`
            if [ "$EXIT_CODE" != "0" ]; then
                printf "[%s] build failed (exit=%s); last 200 log lines:\n" "$RUNTIME" "$EXIT_CODE"
                "$RUNTIME" logs --tail 200 "$CONTAINER_NAME" >&2 || true
                "$RUNTIME" rm -f "$CONTAINER_NAME" 2>/dev/null || true
                "$RUNTIME" volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
                exit 5
            fi
            break
            ;;
        running|created)
            sleep 2
            ATTEMPTS=$((ATTEMPTS + 1))
            ;;
        *)
            sleep 2
            ATTEMPTS=$((ATTEMPTS + 1))
            ;;
    esac
done

if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    printf "[%s] build timed out (status=%s); last 200 log lines:\n" "$RUNTIME" "$STATUS" >&2
    "$RUNTIME" logs --tail 200 "$CONTAINER_NAME" >&2 || true
    "$RUNTIME" rm -f "$CONTAINER_NAME" 2>/dev/null || true
    "$RUNTIME" volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
    exit 5
fi

# === Extract the artifact ===
# The entrypoint writes the package to /out/<artifact> inside the
# named volume. We `cp` it to <repo>/dist/packages/<distro>/; the
# cp path uses the runtime's privilege, which has CAP_CHOWN over
# the operator's mapped uids, so the file lands on the host owned
# by the operator.
ARTIFACT_NAME=`"$RUNTIME" logs "$CONTAINER_NAME" 2>/dev/null | grep '^BUILT: /out/' | sed 's|^BUILT: /out/||' | tail -n 1`
if [ -z "$ARTIFACT_NAME" ]; then
    printf "[%s] build did not print BUILT: /out/... -- last 200 log lines:\n" "$RUNTIME" >&2
    "$RUNTIME" logs --tail 200 "$CONTAINER_NAME" >&2 || true
    "$RUNTIME" rm -f "$CONTAINER_NAME" 2>/dev/null || true
    "$RUNTIME" volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
    exit 6
fi

printf "[%s] copying %s -> %s\n" "$RUNTIME" "$ARTIFACT_NAME" "$OUT_DIR"
"$RUNTIME" cp "$CONTAINER_NAME:/out/$ARTIFACT_NAME" "$OUT_DIR/$ARTIFACT_NAME" || {
    printf "[%s] cp failed -- aborting\n" "$RUNTIME" >&2
    "$RUNTIME" rm -f "$CONTAINER_NAME" 2>/dev/null || true
    "$RUNTIME" volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
    exit 5
}

# Clean up the container and the volume. The container has already
# exited; we drop it to free the name and the volume to free the
# storage driver space. These are explicit rm calls instead of
# relying on --rm, which doesn't survive the inspect-poll race
# cleanly on all runtimes.
"$RUNTIME" rm -f "$CONTAINER_NAME" 2>/dev/null || true
"$RUNTIME" volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true

# === Report ===
# The artifact is now in <repo>/dist/packages/<distro>/ owned by
# the operator -- mv / rm / install all work without sudo.
printf "ok: %s package(s) for %s:\n" "$REPO_NAME" "$DISTRO"
ls -la "$OUT_DIR" || true
