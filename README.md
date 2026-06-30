# honcho-inspector-ui

Angular 22 view-only dashboard for [honcho-self-backend](../honcho-self-backend). All Honcho API calls go through the Spring Boot backend — the browser never sees an API key.

License: **BSD 3-Clause**. See [LICENSE](LICENSE).

Part of the **honcho-self** product, split across two repos:

| Repo | Purpose |
|---|---|
| [honcho-self-ui](https://github.com/cloudbsdorg/honcho-self-ui) (this) | Angular 22 view-only dashboard, served by `ng serve` in dev and the backend in prod |
| [honcho-self-backend](https://github.com/cloudbsdorg/honcho-self-backend) | Spring Boot 4.1 + Java 25, SQLite. The browser-facing process in production; loopback-only in dev. |

## Stack

- **Angular 22** standalone components, signals, `inject()`
- **TypeScript 6**, strict mode
- **Tailwind v4** (via `@tailwindcss/postcss`)
- **Chart.js 4** for the admin overview graphs (bar, line, doughnut)
- **Vitest** + Angular `@angular/build:unit-test` for unit tests
- **No `@angular/forms` HttpClient** — uses `globalThis.fetch` (testable in jsdom)
- **No `BehaviorSubject`** — all state is `signal()` / `computed()`
- **`proxy.conf.mjs`** — a small JavaScript module loaded by `ng serve` that forwards `/api/*` to the loopback-only backend. Auditable code, not opaque JSON config.

## TL;DR

```bash
# terminal 1 — start the backend (loopback-only, port 8080)
npm run backend

# terminal 2 — start the frontend dev server (ng serve + proxy.conf.mjs, port 4200)
npm start

# browser: open http://localhost:4200
```

The browser hits **port 4200** in dev. The backend on **port 8080** is on loopback and not internet-addressable. `proxy.conf.mjs` is the in-process relay that makes the browser's `/api/*` calls reach the backend.

## Quick start

### Prereqs

- Node 20+
- Java 25 + Maven (the backend runs on port 8080, bound to loopback only)

### Install + run

```bash
npm install
npm start
```

Open **http://localhost:4200** in your browser. The flow depends on backend state:

- **First-run** (no users in the backend database) → the UI routes you to `/setup` and shows the **first-run wizard**. Pick a username, password, and optional name/email; submit to create the first admin. You are signed in automatically.
- **Normal** → the UI routes you to `/login` and shows the **login modal**. Enter your credentials. Users are created by admins from `/admin`, not from the login page.

Public self-registration was removed when the backend added admin RBAC. New accounts are provisioned exclusively by an existing admin.

### Run with backend (two terminals)

The browser talks only to **port 4200** in dev — never to the backend's port directly. `ng serve` loads `proxy.conf.mjs` internally, which forwards `/api/*` to the backend on `127.0.0.1:8080` (loopback).

```bash
# terminal 1 — start the backend (loopback-only)
npm run backend

# terminal 2 — start ng serve (browser-facing, port 4200)
npm start
# Open http://localhost:4200
```

`ng serve` listens on `0.0.0.0:4200` (configured in `angular.json`'s `serve` architect) and uses `proxy.conf.mjs` to forward `/api/*` requests to `http://127.0.0.1:8080`. The proxy is **in-process** inside `ng serve` — same-origin from the browser's perspective, no CORS.

### Test

```bash
npm test                              # vitest in watch mode
npx ng test --watch=false             # one-shot CI mode
```

### Build

```bash
npm run build                         # production build → dist/honcho-inspector-ui/browser/
```

The build output is served by the backend in production (see "Deployment" below).

## Architecture: dev vs prod

The dev and prod topologies look different on the surface, but the **browser's view** is the same in both: one origin, `/api/*` are relative paths, the backend is reached through that origin only.

| | **Dev** | **Prod** |
|---|---|---|
| Browser hits | `http://localhost:4200` | `https://honcho.example.com` (or whichever host nginx terminates TLS for) |
| Frontend process | `ng serve` (Angular CLI dev server) | Spring Boot backend serving `dist/.../browser/` |
| Frontend port | `4200` (internet-facing, `0.0.0.0`) | Configurable; default `4200` for the backend (`HONCHO_BIND_ADDRESS=0.0.0.0:4200` behind nginx) |
| Backend port | `8080` loopback-only (`127.0.0.1:8080`) | Same port as the frontend (one-origin); serves SPA + `/api/*` together |
| Relay from frontend to backend | `proxy.conf.mjs` (in-process, loaded by `ng serve` via `angular.json` `proxyConfig`) | None — same-origin, no relay needed |
| HMR | Yes (`ng serve` watches files) | No (`ng build` output is static) |
| Browser sees the backend port? | No | No (same origin) |
| Reverse proxy | None (laptop dev) | nginx (or another TLS-terminating reverse proxy) in front of the backend |

**Why two ports in dev, one in prod?** `ng serve` is a separate process — it owns `4200` and proxies `/api/*` to the backend on `:8080`. In prod there is no `ng serve`; the backend serves the built SPA from `dist/` and the `/api/*` endpoints from the same origin on one port. The browser never sees the difference.

### Dev-mode data flow

```
   Browser (your laptop)
        │
        │  http://localhost:4200       ← the only thing the browser talks to
        ▼
   ng serve :4200  (process spawned by `npm start`)
        │
        │  proxy.conf.mjs  (in-process, JavaScript module)
        │
        ├─ /api/*            ──► http://127.0.0.1:8080   (Spring Boot backend, loopback-only)
        │
        └─ /*                ──► same-process SPA + HMR
```

- **Browser**: only knows about port `4200`. Never sees `8080` or the loopback loopback port.
- **`ng serve`**: runs with `proxyConfig: "proxy.conf.mjs"` (set in `angular.json`'s `serve` architect). Listens on `0.0.0.0:4200` (internet-facing so the browser can reach it from the LAN if needed).
- **`proxy.conf.mjs`**: an ESM JavaScript module that exports a config object consumed by `ng serve`'s built-in proxy. It rewrites `/api/*` to `http://127.0.0.1:8080`. Lives next to `angular.json` so the proxy logic stays auditable as code, not opaque JSON.
- **Spring Boot backend**: `127.0.0.1:8080`. Loopback-only (`server.address: 127.0.0.1` in `application.yml`, default). The browser cannot reach it directly. The `MUST NOT DO` list forbade CORS, so the only way for the browser to talk to the backend is through the proxy.

### Prod-mode data flow

```
   Browser (internet)
        │
        │  https://honcho.example.com   ← TLS terminated by nginx
        ▼
   nginx  (TLS-terminating reverse proxy)
        │
        │  proxy_pass http://127.0.0.1:4200   (or whatever port the backend serves on)
        ▼
   Spring Boot backend :4200  (binds 0.0.0.0:4200 in prod)
        │
        ├─ /*          ──► serves SPA from HONCHO_UI_DIST (default /usr/local/share/honcho-inspector/ui)
        │
        └─ /api/*      ──► same process, REST controllers
```

- **No proxy file.** No `proxy.conf.mjs`. No relay process. Same-origin: the browser talks to the backend's public face and the backend decides whether the request is a SPA route (serve `index.html` fallback) or an API route (route to a controller).
- **nginx**: TLS termination only. It does not need to know about `/api/*` — the backend serves both the SPA and the API on the same origin, and nginx just proxies byte-for-byte.
- **Backend**: built and deployed as a single jar. Reads `HONCHO_UI_DIST` to know where the SPA assets live. The default is `/usr/local/share/honcho-inspector/ui`, which is where the systemd unit / all-in-one Containerfile bakes the Angular `dist`.

### Why no `proxy.conf.json`?

A `.json` file is opaque to the operator — they can't trace what gets forwarded, can't add a header inspection, can't easily review a diff. `.mjs` is a JavaScript module: auditable code, type-checkable in editors, can import helpers, can short-circuit on conditions. `ng serve` natively supports `*.mjs` proxy configs via its `proxyConfig` option.

### Why loopback binding on the backend in dev?

Even on a developer laptop on a hostile Wi-Fi network, the backend is not exposed. `server.address: 127.0.0.1` in `application.yml` enforces this by default; the `backend` script in `package.json` sets `HONCHO_BIND_ADDRESS=127.0.0.1` explicitly. The backend can be reached only through `proxy.conf.mjs`, which runs inside `ng serve` on the same loopback interface.

In prod the operator is responsible for choosing the bind address — typically `0.0.0.0:4200` with nginx in front, or `127.0.0.1:4200` if nginx lives on the same host and binds to all interfaces itself.

### Routes (UI router)

| Path | Guard | Purpose |
|---|---|---|
| `/setup` | `setupGuard` | First-run wizard; only reachable when backend reports `firstRun === true` |
| `/login` | none | Login modal |
| `/profiles` | `authGuard` | Profile selector (create / edit / delete / test) |
| `/` | `authGuard` | Dashboard (peers, sessions, queue, chat) |
| `/inspector` | `authGuard` | Memory inspector (peer deep-dive) |
| `/admin` | `authGuard`, `adminGuard` | Admin panel (users, audit log, overview charts, maintenance); admin-only |
| `**` | none | Redirect to `/` |

### Auth flow

The UI is gated by an `authGuard`. Before redirecting to `/login`, the guard probes `GET /api/health`; if `firstRun === true` it routes to `/setup` instead.

1. **First-run** → `POST /api/setup/first-admin` with `{ username, password, firstname?, lastname?, email? }` → store `{ sessionId, user }` in localStorage.
2. **Login** → `POST /api/auth/login` with `{ username, password }` → store `{ sessionId, user }` in localStorage.
3. **Every API call** → send `X-Session-Id: <sessionId>` header. The proxy (`proxy.conf.mjs`) forwards it transparently in dev; in prod it's same-origin so the browser sends it directly.
4. **Honcho calls** → also send `X-Honcho-Profile-Id: <activeProfileId>` header.
5. **Logout** → `POST /api/auth/logout`, then clear localStorage.

`HonchoAuthService` is a `providedIn: 'root'` signal service. It owns the `credentials` signal and exposes `isAdmin` / `user` computed signals. `ProfileService` owns the `profiles` and `activeProfileId` signals. `HonchoService` reads both.

### Components

- `App` — router host
- `SetupWizard` — multi-step first-run wizard (`/setup`)
- `LoginModal` — username + password form (`/login`)
- `ProfileSelector` — list/create/edit/delete/test profiles (`/profiles`)
- `Dashboard` — main view; header shows an **Admin** button when `auth.isAdmin()` is true
- `MemoryInspector` — peer deep-dive (`/inspector`)
- `ChatPanel` — Honcho chat
- `AdminPanel` — admin-only: users tab, audit tab, overview tab (counts bar chart + 7d/30d growth line chart + audit-action doughnut), maintenance tab (`/admin`)
- `ChartComponent` — thin Chart.js wrapper (`<canvas>` based, OnPush)
- `ThemePicker` — six themes: Miami Vice, Retro CRT, Windows 95, SunOS, CDE, Modern Glass

### Presentation mode

Set `HONCHO_UI_API_KEY_VISIBLE_TO_NON_ADMIN=false` on the backend to lock down the Honcho API-key surface for non-admin users during product demos. The frontend reads the value via `GET /api/health` (`apiKeyVisibleToNonAdmin`); when `false`, `ProfileSelector` hides the **Reveal API Key** button + the **API Key** edit field on the profile form for non-admin sessions, and the corresponding `ProfileController` endpoints (`reveal`, `PUT` with `apiKey` in body, `test`) return 403 for non-admin callers. Admins always have full access. The flag defaults to `true` (current behavior) — flip it in the backend environment or `/etc/honcho-inspector/application.yml` before a demo and revert afterwards.

### Services

- `HonchoAuthService` — session + current user + setup/login/logout/me
- `HealthService` — `GET /api/health` (firstRun, needsRegister)
- `ProfileService` — profile CRUD + active selection
- `HonchoService` — Honcho API client (proxied through `proxy.conf.mjs` in dev; same-origin in prod)
- `AdminService` — `/api/admin/users`, `/api/admin/audit`, `/api/admin/dashboard/overview`, `/api/admin/metrics/counters`, `/api/admin/maintenance/*`
- `ThemeService` — current theme, persisted to localStorage

## Configuration

### Dev: `proxy.conf.mjs`

`proxy.conf.mjs` lives at the repo root and is referenced by `angular.json` via the `serve` architect's `proxyConfig` option:

```js
// proxy.conf.mjs
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

export default {
  '/api': {
    target: BACKEND_URL,
    secure: false,
    changeOrigin: false,
    logLevel: 'info',
  },
};
```

Override the target via `BACKEND_URL` env if your backend lives somewhere other than `127.0.0.1:8080` (e.g. a remote dev box reachable via SSH tunnel). Default is fine for the standard two-terminal local setup.

### Dev: backend bind address

The `backend` script in `package.json` sets `HONCHO_BIND_ADDRESS=127.0.0.1` before invoking Maven. To run the backend on a non-loopback address in dev (for testing from another machine on the LAN), override it:

```bash
HONCHO_BIND_ADDRESS=0.0.0.0 npm run backend
```

You should only do this on a trusted network — the backend has no auth on `/actuator/*` and exposes `info`, `health`, `metrics`, and `prometheus` endpoints.

### Prod: `HONCHO_UI_DIST`

The backend serves the built SPA from the path in `HONCHO_UI_DIST`. Default `/usr/local/share/honcho-inspector/ui`. Set it to wherever you unpack the Angular `dist/honcho-inspector-ui/browser/` output.

### Prod: backend bind address

The operator chooses. The shipped systemd unit binds `0.0.0.0:4200` so nginx can proxy to `127.0.0.1:4200`. The operator can pick any port (override `PORT` env var).

### Prod: there is no proxy file

In production the backend serves **both** the SPA and `/api/*` on the same origin. There is **no `proxy.conf.mjs`** in production. Nginx proxies byte-for-byte; it does not need to know which paths are SPA routes vs API routes because everything reaches the same backend process.

## Deployment

### Build the SPA

```bash
npm run build
# output: dist/honcho-inspector-ui/browser/*
```

Copy the contents of `dist/honcho-inspector-ui/browser/` to wherever `HONCHO_UI_DIST` points on the production host. The shipped path is `/usr/local/share/honcho-inspector/ui`.

### Production nginx (TLS-terminating reverse proxy)

In production, nginx terminates TLS and proxies to the backend. The backend serves SPA + API from the same origin (the `HONCHO_BIND_ADDRESS:PORT` it's bound to — `0.0.0.0:4200` in the shipped systemd unit). Nginx does not need to distinguish `/api/*` from `/*`:

```nginx
server {
  listen 443 ssl http2;
  server_name honcho.example.com;

  # The backend on :4200 serves the SPA (dist/) AND /api/*.
  # One origin. No proxy file in production.
  location / {
    proxy_pass http://127.0.0.1:4200;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

The backend's port (`:4200` in this example) is whatever the operator chose via the systemd unit's `PORT` env var; update `proxy_pass` to match. The `0.0.0.0:4200` bind means nginx (on the same host) reaches the backend over loopback in the `proxy_pass` line; nginx itself binds `0.0.0.0:443` for the public side.

### Production systemd

The systemd unit runs the **Spring Boot backend** bound to `0.0.0.0:4200`, with the SPA assets at `/usr/local/share/honcho-inspector/ui`. There is no separate `node` process, no `ng serve`, no `dev-server`:

```ini
# /etc/systemd/system/honcho-inspector.service
[Service]
Environment=HONCHO_BIND_ADDRESS=0.0.0.0
Environment=PORT=4200
Environment=HONCHO_UI_DIST=/usr/local/share/honcho-inspector/ui
ExecStart=/usr/bin/java -jar /usr/lib/honcho-inspector/honcho-self-backend.jar
```

For dev / single-host deployments without nginx, you can keep the backend on `127.0.0.1:4200` and put nginx in front of THAT — but the default is the same-origin, no-proxy shape above. There is no separate UI systemd unit; the backend is the only persistent process.

### Local dev sanity-check (no nginx)

The dev workflow does not use nginx. `ng serve` runs on `:4200` with `proxy.conf.mjs`. The browser hits `http://localhost:4200` directly. The backend stays loopback-only.

## Dev workflow

- `npm run backend` to start the Spring Boot backend on `:8080` (loopback-only). Run this in a terminal.
- `npm start` (alias of `npm run dev`) to launch `ng serve` on `:4200` with `proxy.conf.mjs` loaded. Browser hits `http://localhost:4200`.
- `npm run watch` to rebuild the SPA on file changes without running a dev server (useful for IDE integration).
- `npx ng test --watch=false` before every commit.
- `npm run build` before tagging a release.
- Themes: edit `src/app/core/theme.service.ts` (the theme list) and the per-theme styles in `src/styles.css`.
- Backend dev: see [honcho-self-backend README](../honcho-self-backend/README.md).

## Repo layout

```
proxy.conf.mjs                           — the dev-mode relay (ESM module, audited by `ng serve`)
angular.json                             — serve architect's proxyConfig = "proxy.conf.mjs"
src/
  app/
    app.ts                               — root component
    app.config.ts                        — DI providers
    app.routes.ts                        — /setup, /login, /profiles, /admin, /, /inspector
    core/
      honcho-auth.service.ts             — session + current user + setup/login/logout/me
      health.service.ts                  — GET /api/health
      admin.service.ts                   — /api/admin/* (users, audit, dashboard, maintenance, metrics)
      profile.service.ts                 — profile CRUD + active selection
      honcho.service.ts                  — Honcho API client (relative /api/* paths; works against any origin)
      theme.service.ts                   — current theme
      metrics.service.ts                 — /api/admin/metrics/counters backend endpoint
      models.ts                          — shared types (Health, AdminUser, AdminAuditEntry, …)
    components/
      setup/                             — first-run wizard (3 steps)
      login-modal/                       — username/password form
      profile-selector/                  — list/create/edit/delete/test profiles
      dashboard/                         — main view (admin nav shown to isAdmin)
      memory-inspector/                  — peer deep-dive
      chat-panel/                        — Honcho chat
      admin/                             — admin panel (users / audit / overview charts / maintenance)
      charts/                            — Chart.js wrapper
      theme-picker/                      — theme switcher
    guards/
      auth.guard.ts                      — checks session + active profile; probes /api/health for firstRun
      setup.guard.ts                     — only allows /setup when firstRun === true
      admin.guard.ts                     — gates /admin to isAdmin === true
src/test-setup.ts                        — jsdom localStorage polyfill
```

## License

BSD 3-Clause. See [LICENSE](LICENSE).

Copyright (c) 2026, REVYTECH, Inc.
