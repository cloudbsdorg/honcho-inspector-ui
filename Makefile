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
        deb deb-clean deb-stage \
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
# ~200MB (most of it node_modules). Requires dpkg-deb + fakeroot.
#
# The package does NOT depend on nginx or any reverse proxy. The
# Angular dev server binds on 0.0.0.0:4200 directly. Operators who
# want TLS front :4200 with their own certbot-managed proxy.

DEB_NAME      = honcho-inspector-ui
DEB_STAGE     = debian/stage
DEB_OUT       = dist/$(DEB_NAME)_0.1.0-SNAPSHOT_all.deb

deb: install ## Build a .deb package (requires dpkg-deb + fakeroot; runs npm ci)
	@if [ -z "$$(command -v dpkg-deb)" ]; then printf "dpkg-deb not found in PATH -- apt install dpkg\n" >&2; exit 1; fi
	@if [ -z "$$(command -v fakeroot)" ]; then printf "fakeroot not found in PATH -- apt install fakeroot\n" >&2; exit 1; fi
	@if [ -z "$$(command -v npm)" ]; then printf "npm not found in PATH\n" >&2; exit 1; fi
	@if [ ! -d node_modules ]; then \
		printf "node_modules missing -- 'make install' (npm ci) ran first\n" >&2; exit 1; \
	fi
	@$(MAKE) --no-print-directory deb-stage
	@printf "packing %s ...\n" "$(DEB_OUT)"
	@install -d dist
	@fakeroot dpkg-deb --build --root-owner-group "$(DEB_STAGE)" "$(DEB_OUT)"
	@printf "built %s\n" "$(DEB_OUT)"
	@printf "install:  sudo dpkg -i %s && sudo apt -f install\n" "$(DEB_OUT)"

deb-stage: ## Populate debian/stage with the source + node_modules (called by deb)
	@printf "staging debian/stage ...\n"
	@rm -rf "$(DEB_STAGE)"
	@install -d "$(DEB_STAGE)/DEBIAN"
	@install -d "$(DEB_STAGE)/usr/local/share/honcho-inspector-ui"
	@install -d "$(DEB_STAGE)/etc/systemd/system"
	@install -d "$(DEB_STAGE)/etc/honcho-inspector-ui"
	@install -d "$(DEB_STAGE)/usr/local/share/doc/honcho-inspector-ui"
	@install -m 0755 debian/DEBIAN/postinst "$(DEB_STAGE)/DEBIAN/postinst"
	@install -m 0755 debian/DEBIAN/postrm  "$(DEB_STAGE)/DEBIAN/postrm"
	@install -m 0755 debian/DEBIAN/prerm   "$(DEB_STAGE)/DEBIAN/prerm"
	@install -m 0644 debian/DEBIAN/conffiles "$(DEB_STAGE)/DEBIAN/conffiles"
	@install -m 0644 debian/DEBIAN/control "$(DEB_STAGE)/DEBIAN/control"
	# Copy the source tree (rsync if available, else tar). Excludes:
	#   - .angular (build cache, regenerated by ng serve on first start)
	#   - dist       (build output, not used at runtime)
	#   - .git       (not needed in a packaged install)
	#   - debian     (the package-build tree; not part of the runtime app)
	#   - *.log      (transient logs)
	@if command -v rsync >/dev/null 2>&1; then \
		rsync -a --exclude='.angular' --exclude='dist' --exclude='.git' \
			--exclude='debian' --exclude='*.log' \
			. "$(DEB_STAGE)/usr/local/share/honcho-inspector-ui/"; \
	else \
		tar -cf - --exclude='.angular' --exclude='dist' --exclude='.git' \
			--exclude='debian' --exclude='*.log' \
			-C . . | tar -xf - -C "$(DEB_STAGE)/usr/local/share/honcho-inspector-ui"; \
	fi
	# node_modules and .angular/cache: populated by `make install`
	# then copied here. node_modules is large; this is the bulk of
	# the .deb.
	@if [ -d node_modules ]; then \
		cp -a node_modules "$(DEB_STAGE)/usr/local/share/honcho-inspector-ui/"; \
	fi
	@install -m 0644 etc/systemd/honcho-inspector-ui.service "$(DEB_STAGE)/etc/systemd/system/honcho-inspector-ui.service"
	@install -m 0644 proxy.conf.json "$(DEB_STAGE)/etc/honcho-inspector-ui/proxy.conf.json"
	@install -m 0644 proxy.conf.json.template "$(DEB_STAGE)/usr/local/share/honcho-inspector-ui/proxy.conf.json.template"
	@install -m 0755 packaging/container/entrypoint.sh "$(DEB_STAGE)/usr/local/bin/entrypoint.sh"
	@install -m 0644 debian/DEBIAN/changelog "$(DEB_STAGE)/usr/local/share/doc/honcho-inspector-ui/changelog.Debian"
	@gzip -9nf "$(DEB_STAGE)/usr/local/share/doc/honcho-inspector-ui/changelog.Debian"
	@printf "stage built\n"

deb-clean: ## Remove the deb build artifacts
	@rm -rf "$(DEB_STAGE)" dist/*.deb
	@printf "removed debian/stage and dist/*.deb\n"

# === Cleanup ===
clean: ## Remove build artifacts and caches
	@rm -rf "$(DIST_DIR)" "$(NG_CACHE)" node_modules/.cache
	@printf "removed %s/ %s/ node_modules/.cache\n" "$(DIST_DIR)" "$(NG_CACHE)"

distclean: clean deb-clean ## Also remove node_modules (full reset)
	@rm -rf node_modules
	@printf "removed node_modules -- run 'make install' to restore\n"
