# Honcho Inspector — Playwright 9-screen regression

End-to-end test harness that drives the full first-run flow of
`honcho-inspector-ui` against a live UI stack.

## What it covers

The spec drives a single ordered narrative as a numbered matrix in
the Playwright HTML report:

| #  | Test                                              | Screen                |
|----|---------------------------------------------------|-----------------------|
| 01 | Setup wizard creates first admin                  | `/setup` (3 steps)    |
| 02 | Profile create submits and shows Active badge     | `/profiles`           |
| 03 | Dashboard renders peers sidebar                   | `/`                   |
| 04 | Inspector · workspace / peers / sessions / conclusions / search | `/inspector` |
| 05 | Admin · overview / users / audit / maintenance    | `/admin`              |
| 06 | Header logout clears session and ends on /login   | `/login`              |
| 07 | Login as admin lands on /profiles                 | `/profiles`           |

Every step captures a full-page screenshot into `SCREENSHOTS_DIR`,
plus the HTML report and per-test failure traces land in
`playwright-report/` and `test-results/`.

## Quick start

```bash
cd tests/e2e
npm install
npx playwright install --with-deps chromium    # one-time
npx playwright test                            # run the matrix
npx playwright show-report                     # open the HTML report
```

## Environment variables

| Var               | Default                     | Purpose                                |
|-------------------|-----------------------------|----------------------------------------|
| `BASE_URL`        | `http://localhost:4200`     | Where the dev server (or smoke proxy) listens |
| `SCREENSHOTS_DIR` | `./screenshots`             | Where `fullPage: true` PNGs land       |

Both are read by both the spec and `playwright.config.ts`.

## Design constraints

### Tolerances (intentional)

- **API failures are tolerated.** The smoke profile registers a
  Honcho connection whose `baseUrl` is `https://mcp.honcho.example`
  — a fake URL the smoke proxy can't reach. The UI shows the
  failure in a banner / empty-state pane. That is expected and
  covered by the assertions; the test never requires the upstream
  to resolve.
- **The DB is fresh on every run.** localStorage is wiped by the
  smoke container. The spec does NOT try to log in first; it
  expects `firstRun: true` from `GET /api/health` and the wizard
  to render.

### Honesty rules (intentional)

- **No retries.** If a step breaks we want to know now, not three
  CI runs later.
- **No anti-detection workarounds.** Every `data-testid` is a real
  selector in `src/app/...`; if one stops resolving the test must
  fail loud so the UI team can update both the component and the
  spec together.
- **Single chromium project, headless, one worker.** We capture
  full-page screenshots and HTML snapshots, not rendered pixels —
  the GPU is irrelevant.

### Worker-scoped `page` fixture

The spec overrides Playwright's default `page` fixture with a
`{ scope: 'worker' }` one. Without this override, every test
gets a fresh `BrowserContext` and localStorage (and therefore the
SPA session) would be wiped between tests. The override keeps a
single context alive for the whole file, which is what makes the
serial narrative behave like a real user clicking through the
app in order.

## Test credentials

The smoke container creates these on a fresh DB:

```
username        admin
password        cloudbsd-admin-2026
workspaceId     default
honchoUserName  admin
apiKey          sk-test-regression-key-2026
baseUrl         https://mcp.honcho.example
```

They are baked into the spec as `USERNAME`, `PASSWORD`, and the
`PROFILE` object.

## Output layout

```
tests/e2e/
├── honcho-inspector.spec.ts        ← the spec
├── playwright.config.ts            ← single chromium project
├── package.json                    ← @playwright/test devDep only
├── tsconfig.json                   ← strict TypeScript
├── README.md                       ← this file
├── screenshots/                    ← created at run time
│   ├── 01a-setup-step1-welcome.png
│   ├── 01b-setup-step2-filled.png
│   ├── …
│   └── 07b-login-success-profiles.png
├── playwright-report/              ← HTML report (created at run time)
└── test-results/                   ← failure traces, videos (created at run time)
```

## Adding a step

Add a `data-testid` to the component (in `src/app/...`), then add a
matching selector in the spec. Do NOT add any logic that masks a
failing selector — the spec is the contract.

## Running a single test

```bash
npx playwright test -g "04 Inspector · workspace tab"
npx playwright test -g "06 Header logout"
```

## CI integration

The harness is `cd tests/e2e && npx playwright test`. Add the
playwright browsers install step (`npx playwright install
--with-deps chromium`) to your image or run it as a `pretest`
hook. The HTML report and screenshots are written to disk; archive
them as build artifacts if you want visual evidence in your CI
provider.
