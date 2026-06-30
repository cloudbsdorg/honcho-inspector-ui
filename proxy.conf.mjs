// Relay / proxy configuration for the Angular dev server.
//
// Lives in TypeScript-flavored ESM JavaScript (`.mjs`) so the proxy
// logic is auditable code, not an opaque JSON config. Angular's
// `loadProxyConfiguration` reads this file via `require()` — see
// `node_modules/@angular/build/src/utils/load-proxy-config.js`.
//
// ## Architecture (dev mode)
//
//   Browser (internet)
//        │
//        ▼
//   ng serve :4200  ← this proxy runs here, in-process
//        │
//        └─ /api/* → http://127.0.0.1:8080  (Spring Boot, loopback)
//
// The browser ONLY talks to port 4200. The Spring Boot backend on
// 8080 is bound to loopback (`server.address: 127.0.0.1` in
// application.yml) so it's not internet-addressable. This file is
// the dev-only relay that lets the browser reach the backend
// without the backend ever being exposed. **It is NOT used in
// production** — production builds serve the SPA from the backend
// directly (`HONCHO_UI_DIST`) on the same origin, no proxy needed.
//
// ## Auth validation
//
// **The backend's `SessionAuthFilter` is the authoritative auth
// check, not this relay.** Every `/api/*` request (except 7 public
// paths: `/api/auth/login`, `/api/health`, `/api/setup/first-admin`,
// `/v3/api-docs`, `/v3/api-docs/swagger-config`, `/swagger-ui`,
// `/swagger-ui/`) must carry a valid `X-Session-Id` header or it
// gets 401. The relay does NOT re-validate auth — it just routes.
// Doing auth at the relay would require duplicating the session DB
// lookup, which is the wrong layer. The backend is the only thing
// that knows what sessions exist.
//
// ## Host header preservation (same-origin through the relay)
//
// We deliberately keep `changeOrigin: false` (the http-proxy default).
// The relay is **in-process inside `ng serve`** (it is not a separate
// listener, it is the Express middleware `ng serve` already runs),
// and the backend on `127.0.0.1:8080` is loopback-only. So the
// browser NEVER reaches the backend except through this relay.
//
// What this means for headers:
//   - The browser sends `Host: <browser-facing hostname>`
//     (e.g. `<operator-hostname>`, or `localhost:4200` on a laptop).
//     The `Origin` header that Spring's CORS filter inspects carries
//     the same hostname.
//   - We must **preserve** that `Host` header byte-for-byte. If we
//     let the http-proxy rewrite `Host` to `127.0.0.1:8080`
//     (`changeOrigin: true`), the backend sees a `Host` of
//     `127.0.0.1:8080` while the `Origin` is `https://<operator-hostname>`
//     — those no longer match, and Spring's CORS filter rejects the
//     request with 403 "Invalid CORS request".
//
// The backend's CORS rule is same-origin detection: when the
// request came **through the relay on the page's own origin**,
// `Origin`'s host will equal `Host`'s host, and the backend allows
// the request without needing any hostname allowlist. This works
// for ANY hostname the operator happens to use — `<operator-hostname>`,
// `localhost`, `192.168.1.5`, etc. — without any per-hostname
// configuration, which matters because this gets installed on other
// people's servers whose hostnames we cannot know in advance.
//
// In prod, the same rule holds because nginx already does
// `proxy_set_header Host $host;` — so `Host` arrives unchanged at
// the backend in production too. One rule, dev and prod.
//
// **The previous comment was wrong.** It claimed `changeOrigin: true`
// "prevents host-based rejection"; in fact `changeOrigin: true`
// *causes* the same-origin mismatch that rejects the request.

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

export default {
  '/api': {
    target: BACKEND_URL,
    secure: false,
    changeOrigin: false,
    logLevel: 'info',
  },
};