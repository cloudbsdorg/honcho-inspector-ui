# Makefile for honcho-inspector-ui
#
# === Portability ===
# This Makefile MUST parse and execute correctly under BOTH:
#   - GNU Make 4.x  (Linux, macOS with Homebrew, etc.)
#   - FreeBSD make (bmake, the BSD-make from pkgsrc / brew)
#
# Avoid GNU-only features:
#   := or ?= for variables      -> use recursive  =  only
#   ifeq / ifneq / ifdef        -> use shell  case  inside recipes
#   $(@D), $(@F), ${var:...}    -> extract logic to scripts/*.sh
#   $(shell ...) for output     -> use backticks (works in both) or
#                                  inline $$(...) in recipes
#   echo -e for colors          -> use printf with hardcoded \033[NNm
#   [[ ... ]]                   -> use [ ... ] (POSIX test)
#   which foo                   -> use command -v foo
#
# Validate before shipping:
#   make -n                     # GNU make dry run
#   bmake -n                    # FreeBSD bmake dry run
#
# If a GNU-only feature is required, the fallback is to extract the logic
# to scripts/*.sh (shell scripts are portable across both makes) and call
# it from the Makefile.
#
# === Self-documenting help ===
# Every public target is declared  target: ## short description
# The trailing  ## description  is the help metadata.
# The help target greps the Makefile itself, so the Makefile is the
# single source of truth for the menu.
# NOTE: we hardcode 'Makefile' rather than using $(MAKEFILE_LIST) because
# the latter is GNU-make-only (bmake leaves it empty). The lesson's
# preference for $(MAKEFILE_LIST) is for projects with `include`d
# fragments; this project has none.
#
# === Scope ===
# This portability rule applies to AUTHORED Makefiles in this project.
# Vendored dependencies and upstream OSS Makefiles are explicitly out
# of scope; touching them requires explicit user authorization and a
# targeted minimal patch (never a rewrite).

# === Variables ===
# Static only — no $(shell ...), no tool detection at parse time.
# Tool detection is done inline in the help recipe via $$(command -v ...).
PROJECT_NAME = honcho-inspector-ui
PROXY_FILE   = proxy.conf.json
DIST_DIR     = dist
NG_CACHE     = .angular
BACKEND_DIR  = ../honcho-self-backend

# === Phony ===
.PHONY: help install update \
        dev start serve \
        build build-prod watch \
        test test-watch test-coverage \
        lint format \
        outdated audit \
        start-backend stop-backend \
        dev-full \
        deb deb-clean \
        packages packages-all packages-debian packages-rocky packages-suse packages-alpine packages-arch packages-void packages-clean \
        image-build image-build-ui-only image-build-clean \
        image-push image-push-ui-only \
        clean distclean

# === Default goal ===
.DEFAULT_GOAL := help

# === Help ===
help: ## Show this help menu
	@printf "\n\033[1m%s (%s/%s)\033[0m\n" \
		"$(PROJECT_NAME)" \
		"$$(uname -s)" \
		"$$(uname -m)"
	@printf "\n\033[1mTools\033[0m\n"
	@printf "\033[36m%-10s\033[0m %s\n" "node"    "$$(command -v node    2>/dev/null | tr -d '\n')"
	@printf "\033[36m%-10s\033[0m %s\n" "npm"     "$$(command -v npm     2>/dev/null | tr -d '\n')"
	@printf "\033[36m%-10s\033[0m %s\n" "ng"      "$$(command -v npx     2>/dev/null | tr -d '\n') (resolves ng from node_modules/.bin)"
	@printf "\n\033[1mTargets\033[0m\n"
	@printf "\033[36m%-22s\033[0m %s\n" "Target" "Description"
	@printf "\033[36m%-22s\033[0m %s\n" "------" "-----------"
	@grep -hE '^[a-zA-Z_-][a-zA-Z0-9_-]*:.*?## .*$$' Makefile | \
		awk -F':.*?## ' '{ printf "\033[36m%-22s\033[0m %s\n", $$1, $$2 }' | \
		sort
	@printf "\n"

# === Install ===
install: ## Clean install from package-lock.json
	@if [ -z "$$(command -v npm)" ]; then printf "npm not found in PATH\n" >&2; exit 1; fi
	npm ci

update: ## Update node_modules to latest from package.json
	@if [ -z "$$(command -v npm)" ]; then printf "npm not found in PATH\n" >&2; exit 1; fi
	npm install

# === Dev server ===
dev: ## Start the dev server (uses proxy.conf.json -> backend at :8080)
	@if [ -z "$$(command -v npx)" ]; then printf "npx not found in PATH\n" >&2; exit 1; fi
	@if [ ! -f "$(PROXY_FILE)" ]; then \
		printf "proxy config not found: %s\n" "$(PROXY_FILE)" >&2; exit 1; \
	fi
	npx ng serve --proxy-config "$(PROXY_FILE)"

start: dev ## Alias for dev

serve: dev ## Alias for dev

# === Build ===
build: ## Production-shaped build (no --configuration flag = dev build)
	@if [ -z "$$(command -v npx)" ]; then printf "npx not found in PATH\n" >&2; exit 1; fi
	npx ng build

build-prod: ## Build with --configuration production (minified, AOT, etc.)
	@if [ -z "$$(command -v npx)" ]; then printf "npx not found in PATH\n" >&2; exit 1; fi
	npx ng build --configuration production

watch: ## Build in watch mode (rebuilds on change; no dev server)
	@if [ -z "$$(command -v npx)" ]; then printf "npx not found in PATH\n" >&2; exit 1; fi
	npx ng build --watch --configuration development

# === Test ===
# Default test target is a one-shot CI-style run (no --watch).
# Use `make test-watch` for the interactive dev loop.

test: ## Run unit tests one-shot (CI mode; no --watch)
	@if [ -z "$$(command -v npx)" ]; then printf "npx not found in PATH\n" >&2; exit 1; fi
	npx ng test --watch=false

test-watch: ## Run unit tests in watch mode (interactive)
	@if [ -z "$$(command -v npx)" ]; then printf "npx not found in PATH\n" >&2; exit 1; fi
	npx ng test

test-coverage: ## Run unit tests with code coverage
	@if [ -z "$$(command -v npx)" ]; then printf "npx not found in PATH\n" >&2; exit 1; fi
	npx ng test --watch=false --code-coverage

# === Quality ===
lint: ## Run ng lint (no linter configured yet — will print a message)
	@if [ -z "$$(command -v npx)" ]; then printf "npx not found in PATH\n" >&2; exit 1; fi
	@if [ ! -f angular.json ] || ! npx ng lint --help >/dev/null 2>&1; then \
		printf "no linter configured -- add eslint to angular.json schematics\n"; \
	else \
		npx ng lint; \
	fi

format: ## Run ng format (or prettier; depends on project config)
	@if [ -z "$$(command -v npx)" ]; then printf "npx not found in PATH\n" >&2; exit 1; fi
	@printf "formatting: prefer prettier via npm (npx prettier --write src/) if configured\n"
	@npx prettier --version >/dev/null 2>&1 && npx prettier --write "src/**/*.{ts,html,css,scss}" || \
		printf "no formatter configured -- add prettier to package.json\n"

# === Dependency health ===
outdated: ## Show outdated dependencies
	@if [ -z "$$(command -v npm)" ]; then printf "npm not found in PATH\n" >&2; exit 1; fi
	npm outdated

audit: ## Run npm audit (security check)
	@if [ -z "$$(command -v npm)" ]; then printf "npm not found in PATH\n" >&2; exit 1; fi
	npm audit

# === Backend orchestration ===
# The Angular dev server proxies /api/* to http://localhost:8080 (see
# proxy.conf.json). For end-to-end dev, you need the backend running too.
# The two `start-backend`/`stop-backend` targets wrap the npm `backend`
# script which shells out to mvn spring-boot:run. Note: it is foreground
# in mvn terms (mvn blocks the terminal), so use it in a separate shell.

start-backend: ## Run the Spring Boot backend in dev mode (mvn spring-boot:run)
	@if [ ! -d "$(BACKEND_DIR)" ]; then \
		printf "backend dir not found: %s\n" "$(BACKEND_DIR)" >&2; exit 1; \
	fi
	@if [ -z "$$(command -v mvn)" ]; then \
		printf "mvn not found in PATH -- start the backend manually\n" >&2; exit 1; \
	fi
	cd "$(BACKEND_DIR)" && mvn -B -ntp spring-boot:run

stop-backend: ## No-op: the backend has no daemon mode; Ctrl-C the foreground process
	@printf "the backend runs in the foreground; press Ctrl-C in its terminal\n"

# Combined dev: run backend in background, frontend in foreground.
# Requires the `nohup` + `&` + a log file. NOT portable to bmake's shell
# defaults on all platforms, so the implementation lives in scripts/ as
# the lesson prescribes. We point at the script if it exists, else print
# the manual instructions.
dev-full: ## Start backend in background + frontend in foreground (uses scripts/dev-full.sh)
	@if [ -x scripts/dev-full.sh ]; then \
		./scripts/dev-full.sh; \
	else \
		printf "no scripts/dev-full.sh -- start the backend in a separate terminal:\n"; \
		printf "  cd %s && mvn spring-boot:run\n" "$(BACKEND_DIR)"; \
		printf "then in this terminal:\n"; \
		printf "  make dev\n"; \
	fi

# === Debian package ===
# `make deb` builds a .deb package. The pipeline is:
#   1. `make install` (npm ci --omit=dev) to populate node_modules.
#   2. Stage the source tree + node_modules + systemd unit + proxy config
#      into debian/stage/.
#   3. fakeroot dpkg-deb --build packs the stage.
#
# The result is dist/honcho-inspector-ui_0.1.0-SNAPSHOT_all.deb,
# ~200MB (most of it node_modules). Built via `fpm` (Ruby gem;
# install with `sudo gem install fpm`) which handles staging, ownership,
# and conffiles in one command. See backend Makefile for the rationale
# on using fpm over hand-rolled `dpkg-deb --build`.
#
# The package does NOT depend on nginx or any reverse proxy. The
# Angular dev server binds on 0.0.0.0:4200 directly. Operators who
# want TLS front :4200 with their own certbot-managed proxy.

DEB_NAME      = honcho-inspector-ui
DEB_VERSION   = 0.1.0-SNAPSHOT
DEB_OUT       = $(CURDIR)/dist/$(DEB_NAME)_$(DEB_VERSION)_all.deb

deb: ## Build a .deb package via fpm (requires fpm)
	@if [ -z "$$(command -v fpm)" ]; then printf "fpm not found in PATH -- sudo gem install fpm\n" >&2; exit 1; fi
	@printf "packing %s ...\n" "$(DEB_OUT)"
	@install -d dist
	@tmpdir="$$(mktemp -d)" && \
	trap "rm -rf '$$tmpdir'" EXIT && \
	cp -a . "$$tmpdir/src" && \
	mkdir -p "$$tmpdir/src/.pkg-scripts" && \
	cp "debian/DEBIAN/postinst" "$$tmpdir/src/.pkg-scripts/" && \
	cp "debian/DEBIAN/prerm" "$$tmpdir/src/.pkg-scripts/" && \
	cp "debian/DEBIAN/postrm" "$$tmpdir/src/.pkg-scripts/" && \
	cp "debian/DEBIAN/changelog" "$$tmpdir/src/.pkg-scripts/" && \
	rm -rf "$$tmpdir/src/.angular" "$$tmpdir/src/dist" "$$tmpdir/src/.git" \
	       "$$tmpdir/src/debian" "$$tmpdir/src/node_modules" && \
	find "$$tmpdir/src" -name '*.log' -delete && \
	cd "$$tmpdir/src" && \
	fpm -s dir -t deb \
	    -p "$(DEB_OUT)" \
	    -n "$(DEB_NAME)" \
	    -v "$(DEB_VERSION)" \
	    -a all \
	    --maintainer "Mark LaPointe <mark@cloudbsd.org>" \
	    --description "Honcho Inspector UI (Angular 22 dashboard). Runs ng serve as a node app under systemd, bound on 0.0.0.0:4200. node_modules is NOT shipped -- the systemd unit runs 'npm ci' as ExecStartPre on first boot so the right native binaries for the host arch get pulled automatically." \
	    --depends "nodejs (>= 20)" \
	    --depends npm \
	    --depends adduser \
	    --deb-no-default-config-files \
	    --deb-systemd etc/systemd/honcho-inspector-ui.service \
	    --deb-systemd-path etc/systemd/system \
	    --after-install .pkg-scripts/postinst \
	    --before-remove .pkg-scripts/prerm \
	    --after-remove .pkg-scripts/postrm \
	    .=/usr/local/share/honcho-inspector-ui \
	    proxy.conf.json=/etc/honcho-inspector-ui/proxy.conf.json \
	    packaging/container/entrypoint.sh=/usr/local/bin/entrypoint.sh \
	    .pkg-scripts/changelog=/usr/local/share/doc/honcho-inspector-ui/changelog.Debian
	@printf "built %s\n" "$(DEB_OUT)"
	@printf "install:  sudo dpkg -i %s && sudo apt -f install\n" "$(DEB_OUT)"

deb-clean: ## Remove the deb build artifacts
	@rm -f dist/*.deb
	@printf "removed dist/*.deb\n"

# === Linux packages (multi-distro, via container) ===
# Each distro has a Containerfile + entrypoint.sh under
# packaging/build/<distro>/ that knows how to build a *native*
# package (deb / rpm / apk / pkg.tar.zst / xbps) for that
# distribution. The wrapper script detects podman (preferred) or
# docker (fallback), builds the per-distro image, and writes the
# artifact to <repo>/dist/packages/<distro>/. Per-distro subdirs
# avoid the collision between the .deb/.rpm output and Angular's
# `ng build` output (which lands at dist/honcho-inspector-ui/).
#
# Targets:
#   make packages-debian     build only the Debian .deb
#   make packages-rocky      build only the Rocky .rpm
#   make packages-suse       build only the openSUSE .rpm
#   make packages-alpine     build only the Alpine .apk
#   make packages-arch       build only the Arch .pkg.tar.zst
#   make packages-void       build only the Void .xbps
#   make packages-all        build all of the above, in order
#   make packages            alias for packages-all
BUILD_PACKAGE_SCRIPT = packaging/scripts/build-package.sh
BUILD_PACKAGE_REPO_NAME = honcho-inspector-ui

packages: packages-all ## Alias for packages-all (default for convenience)

packages-all: ## Build a native package for every supported Linux distro
	@for d in debian rocky suse alpine arch void; do \
		printf "\n=========================================================\n"; \
		printf "  building for: %s\n" "$$d"; \
		printf "=========================================================\n"; \
		"$(BUILD_PACKAGE_SCRIPT)" "$(BUILD_PACKAGE_REPO_NAME)" "$$d" $(BUILD_PACKAGE_EXTRA_ARGS) || exit $$?; \
	done
	@printf "\nall distro packages built; output under: %s/\n" "dist/packages"

packages-debian: ## Build the Debian .deb (debian 13 / trixie)
	"$(BUILD_PACKAGE_SCRIPT)" "$(BUILD_PACKAGE_REPO_NAME)" debian $(BUILD_PACKAGE_EXTRA_ARGS)

packages-rocky: ## Build the Rocky Linux .rpm (rocky 10)
	"$(BUILD_PACKAGE_SCRIPT)" "$(BUILD_PACKAGE_REPO_NAME)" rocky $(BUILD_PACKAGE_EXTRA_ARGS)

packages-suse: ## Build the openSUSE .rpm (leap 16)
	"$(BUILD_PACKAGE_SCRIPT)" "$(BUILD_PACKAGE_REPO_NAME)" suse $(BUILD_PACKAGE_EXTRA_ARGS)

packages-alpine: ## Build the Alpine .apk (alpine 3.23)
	"$(BUILD_PACKAGE_SCRIPT)" "$(BUILD_PACKAGE_REPO_NAME)" alpine $(BUILD_PACKAGE_EXTRA_ARGS)

packages-arch: ## Build the Arch Linux .pkg.tar.zst (rolling)
	"$(BUILD_PACKAGE_SCRIPT)" "$(BUILD_PACKAGE_REPO_NAME)" arch $(BUILD_PACKAGE_EXTRA_ARGS)

packages-void: ## Build the Void Linux .xbps (glibc, rolling)
	"$(BUILD_PACKAGE_SCRIPT)" "$(BUILD_PACKAGE_REPO_NAME)" void $(BUILD_PACKAGE_EXTRA_ARGS)

packages-clean: ## Remove dist/packages/ (Linux package output)
	@if [ -d dist/packages ]; then \
		rm -rf dist/packages; \
		printf "removed dist/packages/\n"; \
	else \
		printf "no dist/packages/ -- nothing to do\n"; \
	fi

# === Container image ===
#
# Multi-arch (linux/amd64 + linux/arm64) container build + push.
# Cross-compilation to arm64 on an amd64 host needs qemu-user-static +
# binfmt-support (Debian/Ubuntu: `apt install qemu-user qemu-user-binfmt`).
#
# The UI repo ships one runtime Containerfile:
#   - packaging/container/Containerfile  -- Alpine + Node 22 + the
#                                            Angular dev server tree,
#                                            exposed on :4200. Operators
#                                            who want to bundle the UI
#                                            inside the backend should
#                                            use the backend repo's
#                                            Containerfile.all-in-one,
#                                            not this one.
#
# The script (packaging/scripts/build-image.sh) handles per-arch build
# + manifest list creation + registry push. Override RUNTIME_REPO,
# RUNTIME_VER, PLATFORMS via env or `make VAR=...` syntax.

IMAGE_NAME      = honcho-inspector-ui
IMAGE_BUILD_SCRIPT = packaging/scripts/build-image.sh

image-build: image-build-ui-only ## Build the standalone UI runtime, multi-arch (no push)

image-build-ui-only: ## Build the standalone UI runtime for every PLATFORM (no push)
	$(IMAGE_BUILD_SCRIPT) $(IMAGE_NAME) ui-only build

image-build-clean: ## Drop locally-built per-arch images + the local manifest list
	@if command -v podman >/dev/null 2>&1; then \
		RT=podman; \
	elif command -v docker >/dev/null 2>&1; then \
		RT=docker; \
	else \
		printf "no container runtime found\n" >&2; exit 1; \
	fi; \
	"$$RT" image rm -f \
		localhost/$(IMAGE_NAME):dev-amd64-ui-only \
		localhost/$(IMAGE_NAME):dev-arm64-ui-only \
		2>/dev/null || true; \
	"$$RT" manifest rm $(IMAGE_NAME):dev-ui-only 2>/dev/null || true; \
	printf "ok: image-build-clean\n"

image-push: image-push-ui-only ## Build + push the UI runtime, multi-arch

image-push-ui-only: image-build-ui-only ## Build + push the UI manifest list
	$(IMAGE_BUILD_SCRIPT) $(IMAGE_NAME) ui-only push

# === Cleanup ===
clean: ## Remove build artifacts and caches
	@rm -rf "$(DIST_DIR)" "$(NG_CACHE)" node_modules/.cache
	@printf "removed %s/ %s/ node_modules/.cache\n" "$(DIST_DIR)" "$(NG_CACHE)"

distclean: clean deb-clean packages-clean image-build-clean ## Also remove node_modules (full reset)
	@rm -rf node_modules
	@printf "removed node_modules -- run 'make install' to restore\n"
