#!/bin/sh
# packaging/scripts/build-image.sh
#
# Build a multi-arch container image (amd64 + arm64 by default) and
# push it as a manifest list to a registry. Two image modes are
# supported:
#
#   backend-only -- the existing packaging/container/Containerfile.
#                   Produces a JDK-based runtime carrying the Spring
#                   Boot fat jar.
#
#   all-in-one    -- the all-in-one Containerfile
#                   (packaging/container/Containerfile.all-in-one).
#                   Produces a single image that runs both backend
#                   and UI on :8080.
#
# Multi-arch strategy:
#
#   1. podman build with --platform linux/amd64,linux/arm64 cross-
#      compiles each arch in turn (qemu-user-static registers the
#      foreign-arch ELF loader via binfmt_misc). Each per-arch build
#      produces an image tagged NAME:VER-<arch>-<mode>.
#
#   2. podman manifest create on the un-arch'd tag NAME:VER-<mode>
#      is a fresh manifest list.
#
#   3. podman manifest add folds each per-arch image into the list.
#
#   4. podman manifest push publishes the manifest list to the
#      registry. docker / podman clients pulling NAME:VER-<mode>
#      walk the manifest and select the arch that matches their
#      runtime automatically.
#
# Tag scheme:
#
#   Per-arch images:    <repo>:<ver>-<arch>-<mode>
#   Manifest list:      <repo>:<ver>-<mode>
#   Optional 'latest': <repo>:latest-<mode>
#
# Default repo is docker.io/revytechinc; override via RUNTIME_REPO.
# Default ver is 0.1.0-SNAPSHOT; override via RUNTIME_VER.
#
# Usage:
#   packaging/scripts/build-image.sh <repo-name> <mode> [cmd]
#     repo-name: honcho-inspector-backend | honcho-inspector-ui
#     mode:      ui-only | backend-only | all-in-one
#     cmd:       build | push | build-and-push  (default build-and-push)
#     (ui-only is the only mode supported in the ui repo; the
#     backend-only + all-in-one modes only make sense in the
#     backend repo, where the Spring Boot jar is built)
#
# Exit codes:
#   0  success
#   1  runtime (podman / docker) not found
#   2  bad args
#   3  qemu-user-static not registered (cross-build will fail)
#   4  a per-arch build failed
#   5  manifest push failed

set -eu

# === Args ===
REPO_NAME="${1:-}"
MODE="${2:-}"
CMD="${3:-build-and-push}"

case "$REPO_NAME" in
    "") printf "usage: %s <repo-name> <mode> [build|push|build-and-push]\n" "$0" >&2; exit 2 ;;
    honcho-inspector-backend|honcho-inspector-ui) ;;
    *) printf "unknown repo-name: %s\n" "$REPO_NAME" >&2; exit 2 ;;
esac
case "$MODE" in
    "") printf "usage: %s <repo-name> <mode>\n" "$0" >&2; exit 2 ;;
    ui-only|backend-only|all-in-one) ;;
    *) printf "unknown mode: %s (supported: ui-only, backend-only, all-in-one)\n" "$MODE" >&2; exit 2 ;;
esac
# Mode/repo compatibility. The UI repo only ships ui-only (the
# Angular dev server image). The backend repo ships backend-only
# (Spring Boot fat-jar image) and all-in-one (Spring Boot + bundled
# Angular dist on a single port). The all-in-one is built by the
# backend repo's own Containerfile.all-in-one, NOT by the UI repo.
case "$REPO_NAME:$MODE" in
    backend-only:ui-only|all-in-one:ui-only|ui-only:backend-only|ui-only:all-in-one) printf "%s + %s is not a supported combination\n" "$REPO_NAME" "$MODE" >&2; exit 2 ;;
esac
case "$CMD" in
    build|push|build-and-push) ;;
    *) printf "unknown cmd: %s (supported: build, push, build-and-push)\n" "$CMD" >&2; exit 2 ;;
esac

# === Paths ===
SCRIPT_DIR=`cd "\`dirname \"$0\"\`" && pwd`
PROJECT_ROOT=`cd "$SCRIPT_DIR/../.." && pwd`

# === Containerfile dispatch ===
case "$MODE" in
    ui-only)
        CONTAINERFILE="$PROJECT_ROOT/packaging/container/Containerfile"
        IMAGE_LOCAL_NAME="$REPO_NAME"
        ;;
    backend-only)
        CONTAINERFILE="$PROJECT_ROOT/packaging/container/Containerfile"
        IMAGE_LOCAL_NAME="$REPO_NAME"
        ;;
    all-in-one)
        CONTAINERFILE="$PROJECT_ROOT/packaging/container/Containerfile.all-in-one"
        IMAGE_LOCAL_NAME="$REPO_NAME-all-in-one"
        ;;
esac

if [ ! -f "$CONTAINERFILE" ]; then
    printf "Containerfile not found: %s\n" "$CONTAINERFILE" >&2
    exit 2
fi

# === Config ===
RUNTIME_REPO="${RUNTIME_REPO:-docker.io/revytechinc/$REPO_NAME}"
RUNTIME_VER="${RUNTIME_VER:-0.1.0-SNAPSHOT}"

# The image name on the registry gets a -<mode> suffix so the
# backend-only image and the all-in-one image coexist as separate
# tags on the same repo:
#   revytechinc/honcho-inspector-backend:0.1.0-SNAPSHOT-ui-only
#   revytechinc/honcho-inspector-backend:0.1.0-SNAPSHOT-backend-only
#   revytechinc/honcho-inspector-backend:0.1.0-SNAPSHOT-all-in-one
# ui-only means the image carries the UI standalone (no backend);
# the same tag scheme is used because the script writes to either
# honcho-inspector-ui or honcho-inspector-backend repos.
case "$MODE" in
    ui-only)       TAG_MANIFEST="${RUNTIME_REPO}:${RUNTIME_VER}-ui-only" ;;
    backend-only) TAG_MANIFEST="${RUNTIME_REPO}:${RUNTIME_VER}-backend-only" ;;
    all-in-one)   TAG_MANIFEST="${RUNTIME_REPO}:${RUNTIME_VER}-all-in-one" ;;
esac

PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

# === Runtime ===
RUNTIME=""
if command -v podman >/dev/null 2>&1; then
    RUNTIME=podman
elif command -v docker >/dev/null 2>&1; then
    RUNTIME=docker
else
    printf "no container runtime found (install podman or docker)\n" >&2
    exit 1
fi

# === qemu / binfmt check ===
# Cross-arch (arm64 on amd64 host, etc.) requires qemu-user-static
# binfmt registration. The uname here is the host's arch:
#   uname == amd64  --> we need to cross-build arm64 unless the host IS arm64
#   uname == arm64  --> we need to cross-build amd64 unless the host IS amd64
HOST_ARCH=`uname -m`
case "$HOST_ARCH" in
    x86_64)        HOST_OS_RELEASE="amd64" ;;
    aarch64)       HOST_OS_RELEASE="arm64" ;;
    *)             HOST_OS_RELEASE="$HOST_ARCH" ;;
esac

NEED_QEMU=0
# Iterate over comma-separated $PLATFORMS in POSIX-portable fashion
# (dash on Ubuntu doesn't grok bash's ${var//pat/rep} expansion).
for p in `printf '%s' "$PLATFORMS" | tr ',' ' '`; do
    p_arch=${p#linux/}
    if [ "$p_arch" != "$HOST_OS_RELEASE" ]; then
        NEED_QEMU=1
        break
    fi
done

if [ "$NEED_QEMU" = "1" ]; then
    if ! ls /proc/sys/fs/binfmt_misc/ 2>/dev/null | grep -q '^qemu-'; then
        printf "cross-arch build requested but no qemu-* binfmt_misc handlers are registered.\n" >&2
        printf "install qemu-user-static + binfmt-support on this host:\n" >&2
        printf "  Debian/Ubuntu: sudo apt install -y qemu-user qemu-user-binfmt\n" >&2
        printf "  Fedora/RHEL:   sudo dnf install -y qemu-user-binfmt qemu-user-static\n" >&2
        printf "  Alpine:        sudo apk add qemu-user-binfmt qemu-openrc\n" >&2
        exit 3
    fi
fi

# === Per-arch build ===
build_one() {
    platform="$1"
    arch="${platform#linux/}"

    tag="${RUNTIME_REPO}:${RUNTIME_VER}-${arch}-${MODE}"
    local_tag="${IMAGE_LOCAL_NAME}:dev-${arch}-${MODE}"

    printf "[%s %s] building %s\n" "$RUNTIME" "$arch" "$local_tag"

    # --pull=missing (not --pull=false): same-arch base images that
    # are already on disk skip the network round-trip, but a
    # cross-arch build (arm64 image built on amd64 host) still
    # fetches the foreign-arch manifest. --pull=false would block
    # the cross-arch fetch and fail with "image not known".
    #
    # The Containerfile may have build-arg-unique requirements.
    # Today only the all-in-one Containerfile takes UI_GIT_REPO /
    # UI_GIT_REF; we forward them unconditionally so a single script
    # works for both modes (the backend-only Containerfile ignores
    # unknown ARGs without crashing).
    "$RUNTIME" build --pull=missing \
        --platform "$platform" \
        --build-arg "UI_GIT_REPO=${UI_GIT_REPO:-https://github.com/cloudbsdorg/honcho-inspector-ui.git}" \
        --build-arg "UI_GIT_REF=${UI_GIT_REF:-main}" \
        -f "$CONTAINERFILE" \
        -t "$local_tag" \
        "$PROJECT_ROOT" >/dev/null || {
            printf "[%s %s] build failed; rerun without /dev/null for the full log\n" "$RUNTIME" "$arch" >&2
            return 1
        }

    # Tag the per-arch image for the registry so podman manifest add
    # can pick it up by tag.
    "$RUNTIME" tag "$local_tag" "$tag" >/dev/null || true
    printf "%s -> %s\n" "$local_tag" "$tag"
}

if [ "$CMD" = "build" ] || [ "$CMD" = "build-and-push" ]; then
    for p in `printf '%s' "$PLATFORMS" | tr ',' ' '`; do
        build_one "$p" || exit 4
    done
fi

# === Manifest list ===
if [ "$CMD" = "push" ] || [ "$CMD" = "build-and-push" ]; then
    # Drop any stale manifest list from a previous run before
    # recreating it; otherwise manifest add appends to existing
    # entries.
    "$RUNTIME" manifest rm "$IMAGE_LOCAL_NAME:dev-${MODE}" >/dev/null 2>&1 || true
    "$RUNTIME" manifest create "$IMAGE_LOCAL_NAME:dev-${MODE}" >/dev/null 2>&1 || true

    for p in `printf '%s' "$PLATFORMS" | tr ',' ' '`; do
        arch="${p#linux/}"
        local_tag="${IMAGE_LOCAL_NAME}:dev-${arch}-${MODE}"
        printf "[%s] manifest add %s (%s)\n" "$RUNTIME" "$local_tag" "$arch"
        "$RUNTIME" manifest add "$IMAGE_LOCAL_NAME:dev-${MODE}" "$local_tag" || {
            printf "manifest add failed for arch %s\n" "$arch" >&2
            "$RUNTIME" manifest rm "$IMAGE_LOCAL_NAME:dev-${MODE}" >/dev/null 2>&1 || true
            exit 5
        }
    done

    # Annotate each entry with the right os/arch so the registry
    # represents the manifest list with the correct descriptors.
    for p in `printf '%s' "$PLATFORMS" | tr ',' ' '`; do
        arch="${p#linux/}"
        case "$p" in
            linux/amd64)   os_arch="linux" ; variant="" ;;
            linux/arm64)   os_arch="arm64" ; variant="" ;;
            linux/arm/v7)  os_arch="arm"   ; variant="v7" ;;
            *)             os_arch="$arch"; variant="" ;;
        esac
        # podman manifest annotate takes --os + --arch + --variant.
        # We re-annotate per-arch so a multi-arm variant stays correct.
        # `manifest add` already fills --os / --arch from the source
        # image, so this is idempotent.
        "$RUNTIME" manifest annotate --os linux --arch "$os_arch" ${variant:+--variant "$variant"} \
            "$IMAGE_LOCAL_NAME:dev-${MODE}" "${IMAGE_LOCAL_NAME}:dev-${arch}-${MODE}" >/dev/null 2>&1 || true
    done

    # Push the manifest list as the un-arch'd tag.
    printf "[%s] manifest push %s -> %s\n" "$RUNTIME" "$IMAGE_LOCAL_NAME:dev-${MODE}" "$TAG_MANIFEST"
    "$RUNTIME" manifest push --format v2s2 "$IMAGE_LOCAL_NAME:dev-${MODE}" "$TAG_MANIFEST" || {
        printf "manifest push failed for %s\n" "$TAG_MANIFEST" >&2
        "$RUNTIME" manifest rm "$IMAGE_LOCAL_NAME:dev-${MODE}" >/dev/null 2>&1 || true
        exit 5
    }

    # Also push the per-arch tags explicitly so individual-arch
    # pulls without manifest-list support work too. This is what
    # older registries / build tools expect.
    for p in `printf '%s' "$PLATFORMS" | tr ',' ' '`; do
        arch="${p#linux/}"
        local_tag="${IMAGE_LOCAL_NAME}:dev-${arch}-${MODE}"
        per_arch_tag="${RUNTIME_REPO}:${RUNTIME_VER}-${arch}-${MODE}"
        printf "[%s] tag push %s -> %s\n" "$RUNTIME" "$local_tag" "$per_arch_tag"
        "$RUNTIME" push "$local_tag" "$per_arch_tag" >/dev/null 2>&1 || {
            printf "tag push failed for %s\n" "$per_arch_tag" >&2
            exit 5
        }
    done

    # Drop the local manifest list -- it was only a carrier for
    # the push and is no longer needed on disk.
    "$RUNTIME" manifest rm "$IMAGE_LOCAL_NAME:dev-${MODE}" >/dev/null 2>&1 || true
fi

# === Report ===
printf "ok: multi-arch %s image\n" "$MODE"
printf "  manifest: %s\n" "$TAG_MANIFEST"
for p in `printf '%s' "$PLATFORMS" | tr ',' ' '`; do
    arch="${p#linux/}"
    printf "  arch:     %s -> %s\n" "$arch" "${RUNTIME_REPO}:${RUNTIME_VER}-${arch}-${MODE}"
done
