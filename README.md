# honcho-inspector-ui

Angular 22 view-only dashboard for [honcho-inspector](../honcho-inspector-backend). All Honcho API calls go through the Spring Boot backend — the browser never sees an API key.

License: **BSD 3-Clause**. See [LICENSE](LICENSE).

Part of the **honcho-inspector** product, split across two repos:

| Repo | Purpose |
|---|---|
| [honcho-inspector-ui](https://github.com/cloudbsdorg/honcho-inspector-ui) (this) | Angular 22 view-only dashboard, dev port 4200 |
| [honcho-inspector-backend](https://github.com/cloudbsdorg/honcho-inspector-backend) | Spring Boot 3.5 + Java 25, SQLite, port 8080 |

## Stack

- **Angular 22** standalone components, signals, `inject()`
- **TypeScript 6**, strict mode
- **Tailwind v4** (via `@tailwindcss/postcss`)
- **Vitest** + Angular `@angular/build:unit-test` for unit tests
- **No `@angular/forms` HttpClient** — uses `globalThis.fetch` (testable in jsdom)
- **No `BehaviorSubject`** — all state is `signal()` / `computed()`

## Quick start

### Prereqs

- Node 20+
- The backend running on `http://localhost:8080` (or set `NG_BACKEND_URL` to override)

### Install + run

```bash
npm install
npm start                            # ng serve --port 4200, proxies /api/* to localhost:8080
```

Open `http://localhost:4200`. The login modal will ask for username + password. First user becomes admin.

### Run with backend

The cleanest dev loop is two terminals:

```bash
# terminal 1
cd ../honcho-self-backend && mvn spring-boot:run

# terminal 2
npm start
```

Or use the convenience script (assumes the backend repo lives at `../honcho-self-backend`):

```bash
npm run backend                       # spring-boot:run in the sibling repo, in the background
npm start                             # ng serve
```

### Test

```bash
npm test                              # vitest in watch mode
npx ng test --watch=false             # one-shot CI mode
```

### Build

```bash
npm run build                         # production build → dist/honcho-inspector-ui/
```

The build is 379.24 kB initial (96.92 kB transfer), well under the 1MB budget.

## Configuration

### Dev backend URL

The Angular dev server proxies `/api/*` to the backend. Default is `http://localhost:8080`. Override with the `NG_BACKEND_URL` env var:

```bash
NG_BACKEND_URL=http://localhost:9090 npm start
```

The proxy config lives in `proxy.conf.json` (consumed by `angular.json`).

### Prod

In prod, the Angular build output (`dist/honcho-inspector-ui/browser/`) is served by a reverse proxy (nginx, Caddy, etc.) that also reverse-proxies `/api/*` to the backend on the same host (or a different internal port). The browser only ever sees relative paths.

There is a `window.__APP_CONFIG__` runtime override slot for the rare case where you want to point at a backend on a different path or host without rebuilding. The reverse proxy can inject this with a `<script>` tag.

## Architecture

### Auth flow

The UI is login-gated by an `authGuard`. The flow is:

1. **Login** → `POST /api/auth/login` with `{ username, password }` → store `{ sessionId, user }` in localStorage.
2. **Every API call** → send `X-Session-Id: <sessionId>` header.
3. **Honcho calls** → also send `X-Honcho-Profile-Id: <activeProfileId>` header.
4. **Logout** → `POST /api/auth/logout`, then clear localStorage.

`HonchoAuthService` is a `providedIn: 'root'` signal service. It owns the `credentials` signal. `ProfileService` owns the `profiles` and `activeProfileId` signals. `HonchoService` reads both.

### Components

- `App` — router host
- `LoginModal` — login + register form, used at `/login`
- `ProfileSelector` — list/create/edit/delete/test profiles, used at `/profiles` and embedded in the dashboard header
- `Dashboard` — the main view (peers, sessions, queue status, chat)
- `MemoryInspector` — deep-dive on a peer's card / representation / conclusions
- `ChatPanel` — chat with a peer (Honcho dialectic)
- `ThemePicker` — six themes: Miami Vice, Retro CRT, Windows 95, SunOS, CDE, Modern Glass

### Services

- `HonchoAuthService` — session + current user
- `ProfileService` — profile CRUD + active selection
- `HonchoService` — Honcho API client (proxied)
- `ThemeService` — current theme, persisted to localStorage

## Build + deploy

```bash
npm run build
# output: dist/honcho-inspector-ui/browser/*
```

Nginx example:

```nginx
server {
  listen 443 ssl http2;
  server_name inspector.example.com;
  root /var/www/honcho-inspector-ui/browser;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;   # SPA fallback
  }

  location /api/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Dev workflow

- `npm start` for the dev server
- `npx ng test --watch=false` before every commit
- `npm run build` before tagging a release
- Themes: edit `src/app/core/theme.service.ts` (the theme list) and the per-theme styles in `src/styles.css`
- Backend dev: see [honcho-inspector-backend README](../honcho-inspector-backend/README.md)

## Repo layout

```
src/
  app/
    app.ts                  — root component
    app.config.ts           — DI providers
    app.routes.ts           — /login, /profiles, /, /inspector
    core/
      honcho-auth.service.ts   — session + current user
      profile.service.ts       — profile CRUD + active selection
      honcho.service.ts        — Honcho API client (proxied)
      theme.service.ts         — current theme
      models.ts                — shared types
    components/
      login-modal/             — username/password form
      profile-selector/        — list/create/edit/delete/test profiles
      dashboard/               — main view
      memory-inspector/        — peer deep-dive
      chat-panel/              — Honcho chat
      theme-picker/            — theme switcher
    guards/
      auth.guard.ts            — checks session + active profile
src/test-setup.ts               — jsdom localStorage polyfill
proxy.conf.json                 — /api/* → http://localhost:8080 (or NG_BACKEND_URL)
```

## License

BSD 3-Clause. See [LICENSE](LICENSE).

Copyright (c) 2026, REVYTECH, Inc.
