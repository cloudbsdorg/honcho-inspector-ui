# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/e2e/honcho-inspector.spec.ts >> Honcho Inspector 9-screen regression >> 01 Setup wizard creates first admin
- Location: tests/e2e/honcho-inspector.spec.ts:114:3

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  15  | }
  16  | 
  17  | async function persistChecks(): Promise<void> {
  18  |   await fs.mkdir(path.dirname(CHECKS_FILE), { recursive: true });
  19  |   await fs.writeFile(CHECKS_FILE, JSON.stringify(checks, null, 2));
  20  | }
  21  | 
  22  | const USERNAME = 'admin';
  23  | /**
  24  |  * Admin password for the smoke container's pre-baked admin user.
  25  |  * Overridable via the {@code HONCHO_ADMIN_PASSWORD} env var so the
  26  |  * matrix can target a live install (where the password is set by
  27  |  * AdminBootstrap on first boot) without editing this file.
  28  |  */
  29  | const PASSWORD = process.env['HONCHO_ADMIN_PASSWORD'] ?? 'cloudbsd-admin-2026';
  30  | 
  31  | /**
  32  |  * Best-effort login against the backend so the fixture seed/cleanup
  33  |  * requests can carry a valid X-Session-Id header. Returns the
  34  |  * session id, or null if the backend isn't reachable yet.
  35  |  */
  36  | async function loginAsAdmin(): Promise<string | null> {
  37  |   try {
  38  |     const ctx = await request.newContext({ baseURL: BACKEND_URL });
  39  |     const r = await ctx.post('/api/auth/login', {
  40  |       data: { username: USERNAME, password: PASSWORD },
  41  |     });
  42  |     if (!r.ok()) {
  43  |       await ctx.dispose();
  44  |       return null;
  45  |     }
  46  |     const body = await r.json();
  47  |     await ctx.dispose();
  48  |     return body.sessionId as string;
  49  |   } catch {
  50  |     return null;
  51  |   }
  52  | }
  53  | 
  54  | async function callFixture(method: 'POST' | 'DELETE', sid: string): Promise<{ status: number; body: unknown }> {
  55  |   const ctx = await request.newContext({ baseURL: BACKEND_URL });
  56  |   const r = await ctx.fetch(`/api/admin/test/seed`, {
  57  |     method,
  58  |     headers: { 'X-Session-Id': sid },
  59  |   });
  60  |   const body = await r.json().catch(() => ({}));
  61  |   await ctx.dispose();
  62  |   return { status: r.status(), body };
  63  | }
  64  | 
  65  | const PROFILE = {
  66  |   label: 'Smoke Test Profile',
  67  |   apiKey: 'sk-test-regression-key-2026',
  68  |   baseUrl: 'https://honcho.example',
  69  |   workspaceId: 'default',
  70  |   honchoUserName: 'admin',
  71  | } as const;
  72  | 
  73  | const test = base.extend({
  74  |   context: async ({ browser }, use) => {
  75  |     const context = await browser.newContext();
  76  |     await use(context);
  77  |     await context.close();
  78  |   },
  79  |   page: async ({ context }, use) => {
  80  |     const page = await context.newPage();
  81  |     await use(page);
  82  |     await page.close();
  83  |   },
  84  | });
  85  | 
  86  | async function shot(page: Page, name: string): Promise<void> {
  87  |   await page.screenshot({
  88  |     path: path.join(SCREENSHOTS_DIR, name),
  89  |     fullPage: true,
  90  |   });
  91  | }
  92  | 
  93  | test.describe.serial('Honcho Inspector 9-screen regression', () => {
  94  |   test.beforeAll(async () => {
  95  |     await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
  96  |     // Seed the deterministic Honcho test fixture so the regression
  97  |     // matrix has a known-good data set on the live Honcho workspace.
  98  |     // Best-effort: a freshly-bootstrapped smoke container with no
  99  |     // existing admin (or a backend without the fixture endpoints)
  100 |     // just skips the seed — the rest of the matrix runs unchanged.
  101 |     const sid = await loginAsAdmin();
  102 |     if (sid) {
  103 |       const r = await callFixture('POST', sid);
  104 |       if (r.status >= 400) {
  105 |         console.warn(`[fixture] seed returned ${r.status}: ${JSON.stringify(r.body)}`);
  106 |       } else {
  107 |         console.log('[fixture] seeded test data');
  108 |       }
  109 |     } else {
  110 |       console.warn('[fixture] no admin session — skipping seed');
  111 |     }
  112 |   });
  113 | 
  114 |   test('01 Setup wizard creates first admin', async ({ page }) => {
> 115 |     await page.goto('/');
      |                ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  116 |     // Skip on installs where an admin already exists (live installs
  117 |     // use the AdminBootstrap path, not the UI wizard). The wizard
  118 |     // is exclusively a smoke-container concern.
  119 |     if (!/\/setup/.test(page.url())) {
  120 |       test.skip(true, 'admin already exists — wizard is smoke-only');
  121 |       return;
  122 |     }
  123 |     await expect(page).toHaveURL(/\/setup/);
  124 | 
  125 |     await expect(page.getByTestId('setup-step-1')).toBeVisible();
  126 |     await check(page, 'welcome-heading', '[data-testid="setup-step-1"]');
  127 |     await check(page, 'welcome-subheading', '[data-testid="setup-step-1"]');
  128 |     await check(page, 'setup-steps', '[data-testid="setup-next"]');
  129 |     await check(page, 'next-button', '[data-testid="setup-next"]');
  130 |     await shot(page, '01a-setup-step1-welcome.png');
  131 |     await page.getByTestId('setup-next').click();
  132 | 
  133 |     await expect(page.getByTestId('setup-step-2')).toBeVisible();
  134 |     await page.getByTestId('setup-username').fill(USERNAME);
  135 |     await page.getByTestId('setup-password').fill(PASSWORD);
  136 |     await page.getByTestId('setup-confirm').fill(PASSWORD);
  137 |     await check(page, 'username-input', '[data-testid="setup-username"]');
  138 |     await check(page, 'password-input', '[data-testid="setup-password"]');
  139 |     await check(page, 'confirm-input', '[data-testid="setup-confirm"]');
  140 |     await shot(page, '01b-setup-step2-filled.png');
  141 |     await page.getByTestId('setup-next').click();
  142 | 
  143 |     await expect(page.getByTestId('setup-step-3')).toBeVisible();
  144 |     await check(page, 'review-heading', '[data-testid="setup-step-3"]');
  145 |     await check(page, 'username-display', '[data-testid="setup-confirm-btn"]');
  146 |     await check(page, 'role-display', '[data-testid="setup-confirm-btn"]');
  147 |     await shot(page, '01c-setup-step3-confirm.png');
  148 |     await page.getByTestId('setup-confirm-btn').click();
  149 | 
  150 |     await page.waitForURL(/\/profiles/, { timeout: 30_000 });
  151 |     await expect(page.getByTestId('profile-selector')).toBeVisible();
  152 |     await shot(page, '01d-setup-complete-profiles.png');
  153 |   });
  154 | 
  155 |   test('02 Profile create submits and shows Active badge', async ({ page }) => {
  156 |     // log in (test 1's session isn't shared because context is per-test now)
  157 |     await page.goto('/login');
  158 |     await page.getByTestId('login-username').fill(USERNAME);
  159 |     await page.getByTestId('login-password').fill(PASSWORD);
  160 |     await page.getByTestId('login-submit').click();
  161 |     await page.waitForURL(/\/profiles/, { timeout: 15_000 });
  162 |     await expect(page.getByTestId('profile-selector')).toBeVisible();
  163 |     await check(page, 'new-profile-button', '[data-testid="new-profile-button"]');
  164 |     await shot(page, '02a-profiles-empty.png');
  165 | 
  166 |     await page.getByTestId('new-profile-button').click();
  167 |     await expect(page.getByTestId('profile-form')).toBeVisible();
  168 | 
  169 |     await page.getByTestId('profile-label').fill(PROFILE.label);
  170 |     await page.getByTestId('profile-apikey').fill(PROFILE.apiKey);
  171 |     await page.getByTestId('profile-baseurl').fill(PROFILE.baseUrl);
  172 |     await page.getByTestId('profile-workspaceid').fill(PROFILE.workspaceId);
  173 |     await page.getByTestId('profile-honchousername').fill(PROFILE.honchoUserName);
  174 |     await check(page, 'label-input', '[data-testid="profile-label"]');
  175 |     await check(page, 'apikey-input', '[data-testid="profile-apikey"]');
  176 |     await check(page, 'baseurl-input', '[data-testid="profile-baseurl"]');
  177 |     await check(page, 'workspaceid-input', '[data-testid="profile-workspaceid"]');
  178 |     await check(page, 'honchousername-input', '[data-testid="profile-honchousername"]');
  179 |     await shot(page, '02b-profile-form-filled.png');
  180 | 
  181 |     await page.getByTestId('profile-save').click();
  182 | 
  183 |     await expect(page.getByTestId('profile-form')).toBeHidden({ timeout: 15_000 });
  184 |     await expect(page.getByTestId('active-badge').first()).toBeVisible();
  185 |     await check(page, 'active-badge', `[data-testid="active-badge"]`);
  186 |     await shot(page, '02c-profile-active.png');
  187 |   });
  188 | 
  189 |   test('03 Dashboard renders peers sidebar', async ({ page }) => {
  190 |     await page.goto('/login');
  191 |     await page.getByTestId('login-username').fill(USERNAME);
  192 |     await page.getByTestId('login-password').fill(PASSWORD);
  193 |     await page.getByTestId('login-submit').click();
  194 |     await page.waitForURL(/\/profiles/, { timeout: 15_000 });
  195 | 
  196 |     await page.goto('/dashboard');
  197 |     await expect(page.getByTestId('app-header')).toBeVisible();
  198 |     await check(page, 'app-header', '[data-testid="app-header"]');
  199 |     await shot(page, '03-dashboard.png');
  200 |   });
  201 | 
  202 |   for (const tabId of ['workspace', 'peers', 'sessions', 'conclusions', 'search'] as const) {
  203 |     test(`04 Inspector · ${tabId} tab`, async ({ page }) => {
  204 |       await page.goto('/login');
  205 |       await page.getByTestId('login-username').fill(USERNAME);
  206 |       await page.getByTestId('login-password').fill(PASSWORD);
  207 |       await page.getByTestId('login-submit').click();
  208 |       await page.waitForURL(/\/profiles/, { timeout: 15_000 });
  209 |       await page.getByTestId("set-active").first().click();
  210 | 
  211 |       await page.goto('/inspector');
  212 |       const tab = page.locator(`[data-testid="tab-button"][data-tab-id="${tabId}"]`);
  213 |       await tab.click();
  214 |       await check(page, `inspector-${tabId}-tab`, `[data-testid="tab-button"][data-tab-id="${tabId}"]`);
  215 |       await shot(page, `04-inspector-${tabId}.png`);
```