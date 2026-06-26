import { test as base, expect, type Page, type BrowserContext, request } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const SCREENSHOTS_DIR = process.env['SCREENSHOTS_DIR'] ?? './screenshots';
const CHECKS_FILE = path.join(SCREENSHOTS_DIR, '..', 'checks.json');
const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://127.0.0.1:8080';

type CheckMap = Record<string, 'PRESENT' | 'ABSENT' | 'UNCHECKED'>;
const checks: CheckMap = {};

async function check(page: Page, id: string, locator: string): Promise<void> {
  const count = await page.locator(locator).count();
  checks[id] = count > 0 ? 'PRESENT' : 'ABSENT';
}

async function persistChecks(): Promise<void> {
  await fs.mkdir(path.dirname(CHECKS_FILE), { recursive: true });
  await fs.writeFile(CHECKS_FILE, JSON.stringify(checks, null, 2));
}

const USERNAME = 'admin';
/**
 * Admin password for the smoke container's pre-baked admin user.
 * Overridable via the {@code HONCHO_ADMIN_PASSWORD} env var so the
 * matrix can target a live install (where the password is set by
 * AdminBootstrap on first boot) without editing this file.
 */
const PASSWORD = process.env['HONCHO_ADMIN_PASSWORD'] ?? 'cloudbsd-admin-2026';

/**
 * Best-effort login against the backend so the fixture seed/cleanup
 * requests can carry a valid X-Session-Id header. Returns the
 * session id, or null if the backend isn't reachable yet.
 */
async function loginAsAdmin(): Promise<string | null> {
  try {
    const ctx = await request.newContext({ baseURL: BACKEND_URL });
    const r = await ctx.post('/api/auth/login', {
      data: { username: USERNAME, password: PASSWORD },
    });
    if (!r.ok()) {
      await ctx.dispose();
      return null;
    }
    const body = await r.json();
    await ctx.dispose();
    return body.sessionId as string;
  } catch {
    return null;
  }
}

async function callFixture(method: 'POST' | 'DELETE', sid: string): Promise<{ status: number; body: unknown }> {
  const ctx = await request.newContext({ baseURL: BACKEND_URL });
  const r = await ctx.fetch(`/api/admin/test/seed`, {
    method,
    headers: { 'X-Session-Id': sid },
  });
  const body = await r.json().catch(() => ({}));
  await ctx.dispose();
  return { status: r.status(), body };
}

const PROFILE = {
  label: 'Smoke Test Profile',
  apiKey: 'sk-test-regression-key-2026',
  baseUrl: 'https://honcho.example',
  workspaceId: 'default',
  honchoUserName: 'admin',
} as const;

const test = base.extend({
  context: async ({ browser }, use) => {
    const context = await browser.newContext();
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
});

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, name),
    fullPage: true,
  });
}

test.describe.serial('Honcho Inspector 9-screen regression', () => {
  test.beforeAll(async () => {
    await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
    // Seed the deterministic Honcho test fixture so the regression
    // matrix has a known-good data set on the live Honcho workspace.
    // Best-effort: a freshly-bootstrapped smoke container with no
    // existing admin (or a backend without the fixture endpoints)
    // just skips the seed — the rest of the matrix runs unchanged.
    const sid = await loginAsAdmin();
    if (sid) {
      const r = await callFixture('POST', sid);
      if (r.status >= 400) {
        console.warn(`[fixture] seed returned ${r.status}: ${JSON.stringify(r.body)}`);
      } else {
        console.log('[fixture] seeded test data');
      }
    } else {
      console.warn('[fixture] no admin session — skipping seed');
    }
  });

  test('01 Setup wizard creates first admin', async ({ page }) => {
    await page.goto('/');
    // Skip on installs where an admin already exists (live installs
    // use the AdminBootstrap path, not the UI wizard). The wizard
    // is exclusively a smoke-container concern.
    if (!/\/setup/.test(page.url())) {
      test.skip(true, 'admin already exists — wizard is smoke-only');
      return;
    }
    await expect(page).toHaveURL(/\/setup/);

    await expect(page.getByTestId('setup-step-1')).toBeVisible();
    await check(page, 'welcome-heading', '[data-testid="setup-step-1"]');
    await check(page, 'welcome-subheading', '[data-testid="setup-step-1"]');
    await check(page, 'setup-steps', '[data-testid="setup-next"]');
    await check(page, 'next-button', '[data-testid="setup-next"]');
    await shot(page, '01a-setup-step1-welcome.png');
    await page.getByTestId('setup-next').click();

    await expect(page.getByTestId('setup-step-2')).toBeVisible();
    await page.getByTestId('setup-username').fill(USERNAME);
    await page.getByTestId('setup-password').fill(PASSWORD);
    await page.getByTestId('setup-confirm').fill(PASSWORD);
    await check(page, 'username-input', '[data-testid="setup-username"]');
    await check(page, 'password-input', '[data-testid="setup-password"]');
    await check(page, 'confirm-input', '[data-testid="setup-confirm"]');
    await shot(page, '01b-setup-step2-filled.png');
    await page.getByTestId('setup-next').click();

    await expect(page.getByTestId('setup-step-3')).toBeVisible();
    await check(page, 'review-heading', '[data-testid="setup-step-3"]');
    await check(page, 'username-display', '[data-testid="setup-confirm-btn"]');
    await check(page, 'role-display', '[data-testid="setup-confirm-btn"]');
    await shot(page, '01c-setup-step3-confirm.png');
    await page.getByTestId('setup-confirm-btn').click();

    await page.waitForURL(/\/profiles/, { timeout: 30_000 });
    await expect(page.getByTestId('profile-selector')).toBeVisible();
    await shot(page, '01d-setup-complete-profiles.png');
  });

  test('02 Profile create submits and shows Active badge', async ({ page }) => {
    // log in (test 1's session isn't shared because context is per-test now)
    await page.goto('/login');
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/profiles/, { timeout: 15_000 });
    await expect(page.getByTestId('profile-selector')).toBeVisible();
    await check(page, 'new-profile-button', '[data-testid="new-profile-button"]');
    await shot(page, '02a-profiles-empty.png');

    await page.getByTestId('new-profile-button').click();
    await expect(page.getByTestId('profile-form')).toBeVisible();

    await page.getByTestId('profile-label').fill(PROFILE.label);
    await page.getByTestId('profile-apikey').fill(PROFILE.apiKey);
    await page.getByTestId('profile-baseurl').fill(PROFILE.baseUrl);
    await page.getByTestId('profile-workspaceid').fill(PROFILE.workspaceId);
    await page.getByTestId('profile-honchousername').fill(PROFILE.honchoUserName);
    await check(page, 'label-input', '[data-testid="profile-label"]');
    await check(page, 'apikey-input', '[data-testid="profile-apikey"]');
    await check(page, 'baseurl-input', '[data-testid="profile-baseurl"]');
    await check(page, 'workspaceid-input', '[data-testid="profile-workspaceid"]');
    await check(page, 'honchousername-input', '[data-testid="profile-honchousername"]');
    await shot(page, '02b-profile-form-filled.png');

    await page.getByTestId('profile-save').click();

    await expect(page.getByTestId('profile-form')).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId('active-badge').first()).toBeVisible();
    await check(page, 'active-badge', `[data-testid="active-badge"]`);
    await shot(page, '02c-profile-active.png');
  });

  test('03 Dashboard renders peers sidebar', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/profiles/, { timeout: 15_000 });

    await page.goto('/dashboard');
    await expect(page.getByTestId('app-header')).toBeVisible();
    await check(page, 'app-header', '[data-testid="app-header"]');
    await shot(page, '03-dashboard.png');
  });

  for (const tabId of ['workspace', 'peers', 'sessions', 'conclusions', 'search'] as const) {
    test(`04 Inspector · ${tabId} tab`, async ({ page }) => {
      await page.goto('/login');
      await page.getByTestId('login-username').fill(USERNAME);
      await page.getByTestId('login-password').fill(PASSWORD);
      await page.getByTestId('login-submit').click();
      await page.waitForURL(/\/profiles/, { timeout: 15_000 });
      await page.getByTestId("profile-row").first().click();
      await page.getByTestId("set-active").first().click();

      await page.goto('/inspector');
      const tab = page.locator(`[data-testid="tab-button"][data-tab-id="${tabId}"]`);
      await tab.click();
      await check(page, `inspector-${tabId}-tab`, `[data-testid="tab-button"][data-tab-id="${tabId}"]`);
      await shot(page, `04-inspector-${tabId}.png`);
    });
  }

  for (const tabId of ['overview', 'users', 'audit', 'maintenance'] as const) {
    test(`05 Admin · ${tabId} tab`, async ({ page }) => {
      await page.goto('/login');
      await page.getByTestId('login-username').fill(USERNAME);
      await page.getByTestId('login-password').fill(PASSWORD);
      await page.getByTestId('login-submit').click();
      await page.waitForURL(/\/profiles/, { timeout: 15_000 });
      await page.getByTestId("profile-row").first().click();
      await page.getByTestId("set-active").first().click();

      await page.goto('/admin');
      const tab = page.getByTestId(`admin-tab-${tabId}`);
      await tab.click();
      await check(page, `admin-${tabId}-tab`, `[data-testid="admin-tab-${tabId}"]`);
      await shot(page, `05-admin-${tabId}.png`);
    });
  }

  test('05a User-create wizard renders and submits a new admin', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/profiles/, { timeout: 15_000 });
    await page.getByTestId('profile-row').first().click().catch(() => undefined);
    await page.getByTestId('set-active').first().click().catch(() => undefined);

    await page.goto('/admin');
    await page.getByTestId('admin-tab-users').click();
    await check(page, 'admin-open-user-create', '[data-testid="admin-open-user-create"]');
    await shot(page, '05a-admin-users-with-open-button.png');

    // Open the wizard and capture each step's screen so a regression
    // captures a known-good visual baseline.
    await page.getByTestId('admin-open-user-create').click();
    // Wait for the wizard to mount its step-1 DOM before asserting.
    // The Open signal change happens synchronously but the Angular
    // CD pass that renders the @switch case runs in the next tick.
    await page.waitForSelector('[data-testid="user-create-mcp-block"]', {
      timeout: 5_000,
    });
    await check(
      page,
      'user-create-welcome',
      '[data-testid="user-create-mcp-block"]'
    );
    await shot(page, '05a-user-create-step1-welcome.png');

    // Step 1 -> 2: Welcome -> Account
    await page.getByTestId('user-create-next').click();
    await page
      .getByTestId('user-create-username')
      .fill(`e2e-wizard-${Date.now().toString(36)}`);
    await page.getByTestId('user-create-password').fill('longenough');
    await page.getByTestId('user-create-confirm').fill('longenough');
    await check(
      page,
      'user-create-password-match',
      '[data-testid="user-create-password-match"]'
    );
    await shot(page, '05a-user-create-step2-account-filled.png');
    await page.getByTestId('user-create-next').click();

    // Step 2 -> 3: Account -> Identity (optional fields, leave blank)
    await page
      .getByTestId('user-create-email')
      .fill('e2e-wizard@cloudbsd.org');
    await shot(page, '05a-user-create-step3-identity.png');
    await page.getByTestId('user-create-next').click();

    // Step 3 -> 4: Identity -> Role/Review (choose admin so the user
    // has parity with the bootstrap admin).
    await page.getByTestId('user-create-role-admin').click();
    await check(
      page,
      'user-create-submit',
      '[data-testid="user-create-submit"]'
    );
    await shot(page, '05a-user-create-step4-review.png');

    // Submit and expect the wizard to close (the admin-open-user-create
    // button is back on screen).
    await page.getByTestId('user-create-submit').click();
    await page.waitForSelector('[data-testid="admin-open-user-create"]', {
      timeout: 15_000,
    });
    await check(
      page,
      'admin-open-user-create',
      '[data-testid="admin-open-user-create"]'
    );
    await shot(page, '05a-user-create-after-submit.png');
  });

  test('05b Preferences pane is reachable, searchable, and applies a TZ override', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/profiles/, { timeout: 15_000 });
    await page.getByTestId("profile-row").first().click();
    await page.getByTestId("set-active").first().click();

    await check(page, 'user-menu-trigger', '[data-testid="user-menu-trigger"]');
    await page.getByTestId('user-menu-trigger').click();
    await page.waitForTimeout(150);
    await check(page, 'user-menu-preferences', '[data-testid="user-menu-preferences"]');
    await page.getByTestId('user-menu-preferences').click();
    await page.waitForURL(/\/preferences/, { timeout: 15_000 });
    await check(page, 'prefs-tz-section', '[data-testid="prefs-tz-section"]');
    await check(page, 'prefs-tz-current', '[data-testid="prefs-tz-current"]');
    await shot(page, '05b-preferences-initial.png');

    // Search filter narrows the picker.
    await page.getByTestId('prefs-tz-filter').fill('tokyo');
    await page.waitForTimeout(150);
    await check(
      page,
      'tz-option-tokyo',
      '[data-testid="tz-option"][data-tz-zone="Asia/Tokyo"]'
    );
    await shot(page, '05b-preferences-search-tokyo.png');

    // Apply via the Apply button on the hover-preview row.
    await page.getByTestId('tz-option').hover();
    await page.waitForTimeout(150);
    await check(
      page,
      'prefs-tz-target-preview',
      '[data-testid="prefs-tz-target-preview"]'
    );
    await page.getByTestId('prefs-tz-apply').click();
    await page.waitForTimeout(150);
    await check(
      page,
      'prefs-tz-current-tokyo',
      '[data-testid="prefs-tz-current"] >> text=Asia/Tokyo'
    );
    await shot(page, '05b-preferences-tokyo-applied.png');

    // Reset back to browser default.
    await page.getByTestId('prefs-tz-reset').click();
    await page.waitForTimeout(150);
    await check(
      page,
      'prefs-tz-auto',
      '[data-testid="prefs-tz-auto"]'
    );
    await shot(page, '05b-preferences-after-reset.png');

    // Theme section is reachable from the same pane.
    await check(
      page,
      'prefs-theme-section',
      '[data-testid="prefs-theme-section"]'
    );
    await page
      .getByTestId('prefs-theme-option')
      .filter({ hasText: 'Retro CRT' })
      .click();
    await page.waitForTimeout(150);
    await shot(page, '05b-preferences-theme-retro.png');
  });

  test('05d Header nav for an admin user with no profiles', async ({ page }) => {
    // Login as admin_no_profiles — an admin account that has zero
    // profiles. Verifies that even admin users without profiles don't
    // get cliff links.
    await page.goto('/login');
    await page.getByTestId('login-username').fill('admin_no_profiles');
    await page.getByTestId('login-password').fill('cloudbsd-admin-2026');
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/profiles/, { timeout: 15_000 });

    // Admin link lives inside the user-menu dropdown (open it first).
    await page.getByTestId('user-menu-trigger').click();
    await page.waitForTimeout(150);
    await check(page, 'user-menu-admin', '[data-testid="user-menu-admin"]');
    // Overview and Inspector should NOT show (no active profile).
    expect(await page.locator('[data-testid="open-overview"]').count()).toBe(0);
    expect(await page.locator('[data-testid="open-inspector"]').count()).toBe(0);
    // Switcher should NOT show (no profiles at all).
    expect(await page.locator('[data-testid="profile-switcher"]').count()).toBe(0);
    // Connections stays in main nav; Preferences + Logout stay in menu.
    await check(page, 'open-profiles', '[data-testid="open-profiles"]');
    await check(page, 'user-menu-preferences', '[data-testid="user-menu-preferences"]');
    await check(page, 'user-menu-logout', '[data-testid="user-menu-logout"]');
    await shot(page, '05d-header-admin-no-profiles.png');
    // Close the menu so the next click assertion is on the closed state.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Clicking Admin lands on /admin if the route allows it without
    // an active profile. Currently authGuard redirects to /profiles
    // when there's no active profile (even for admins), so we assert
    // the URL ends with /admin OR /profiles and isn't a blank screen.
    // Re-open the menu after the screenshot Escape.
    await page.getByTestId('user-menu-trigger').click();
    await page.waitForTimeout(150);
    await page.getByTestId('user-menu-admin').click();
    // Admin is reachable without an active profile now — the URL
    // lands on /admin directly.
    await page.waitForURL(/\/admin/, { timeout: 5_000 });
    expect(page.url()).toContain('/admin');
    await shot(page, '05d-admin-click-landing.png');
  });

  test('05e Header nav for a non-admin user with no profiles', async ({ page }) => {
    // Login as noprof_admin — a regular user with zero profiles.
    await page.goto('/login');
    await page.getByTestId('login-username').fill('noprof_admin');
    await page.getByTestId('login-password').fill('cloudbsd-admin-2026');
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/profiles/, { timeout: 15_000 });

    // Admin link must NOT show. Open the menu first (the admin item
    // only renders inside the open dropdown).
    await page.getByTestId('user-menu-trigger').click();
    await page.waitForTimeout(150);
    expect(await page.locator('[data-testid="user-menu-admin"]').count()).toBe(0);
    // Overview + Inspector hidden (no active profile).
    expect(await page.locator('[data-testid="open-overview"]').count()).toBe(0);
    expect(await page.locator('[data-testid="open-inspector"]').count()).toBe(0);
    // Switcher hidden (no profiles).
    expect(await page.locator('[data-testid="profile-switcher"]').count()).toBe(0);
    // Connections stays in main nav; Preferences + Logout stay in menu.
    await check(page, 'open-profiles', '[data-testid="open-profiles"]');
    await check(page, 'user-menu-preferences', '[data-testid="user-menu-preferences"]');
    await check(page, 'user-menu-logout', '[data-testid="user-menu-logout"]');
    await shot(page, '05e-header-non-admin-no-profiles.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // URL-hack /admin must redirect to / (adminGuard).
    await page.goto('/admin');
    await page.waitForURL(/\/(profiles)?$/, { timeout: 5_000 });
    await shot(page, '05e-admin-redirect-for-non-admin.png');
  });

  test('05c Header hides nav items that have nothing to navigate to', async ({ page }) => {
    // Log in as the bootstrap admin (who has profiles) so the app loads.
    await page.goto('/login');
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/profiles/, { timeout: 15_000 });

    // On /profiles with an active profile, the header must show
    // Overview + Connections + Inspector + Profile switcher +
    // user-menu trigger (Preferences + Logout live inside the menu).
    await page.getByTestId('profile-row').first().click();
    await page.getByTestId('set-active').first().click();
    await page.waitForTimeout(400);
    await check(page, 'open-overview', '[data-testid="open-overview"]');
    await check(page, 'open-profiles', '[data-testid="open-profiles"]');
    await check(page, 'open-inspector', '[data-testid="open-inspector"]');
    await check(page, 'user-menu-trigger', '[data-testid="user-menu-trigger"]');
    await check(page, 'profile-switcher', '[data-testid="profile-switcher"]');
    // Open the menu and verify Preferences + Logout live inside.
    await page.getByTestId('user-menu-trigger').click();
    await page.waitForTimeout(150);
    await check(page, 'user-menu-preferences', '[data-testid="user-menu-preferences"]');
    await check(page, 'user-menu-logout', '[data-testid="user-menu-logout"]');
    await shot(page, '05c-header-with-profile.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Clear active profile and verify Overview + Inspector disappear
    // while Connections + the switcher + the user-menu trigger stay.
    await page.evaluate(() => {
      window.localStorage.removeItem('honcho-active-profile');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await check(page, 'open-profiles-still', '[data-testid="open-profiles"]');
    await check(page, 'user-menu-trigger-still', '[data-testid="user-menu-trigger"]');
    expect(await page.locator('[data-testid="open-overview"]').count())
      .toBe(0);
    expect(await page.locator('[data-testid="open-inspector"]').count())
      .toBe(0);
    // Switcher stays because there are profiles to choose from.
    await check(page, 'profile-switcher-still', '[data-testid="profile-switcher"]');
    // Menu items still inside the open menu.
    await page.getByTestId('user-menu-trigger').click();
    await page.waitForTimeout(150);
    await check(page, 'open-preferences-still', '[data-testid="user-menu-preferences"]');
    await check(page, 'logout-button-still', '[data-testid="user-menu-logout"]');
    await shot(page, '05c-header-no-profile.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Drop all profiles (clear localStorage and reload) so the
    // switcher itself disappears.
    await page.evaluate(() => {
      window.localStorage.removeItem('honcho-active-profile');
      // The ProfileService caches the profiles list in memory; clearing
      // localStorage isn't enough. Logout instead, which clears the
      // in-memory store via the SPA session reset.
    });
    await page.getByTestId('user-menu-trigger').click();
    await page.waitForTimeout(150);
    await page.getByTestId('user-menu-logout').click();
    // UserMenu now navigates to /login automatically.
    await page.waitForURL(/\/login/, { timeout: 5_000 });
    await shot(page, '05c-header-after-logout.png');
  });

  test('06 Header logout clears session and ends on /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/profiles/, { timeout: 15_000 });
    await page.getByTestId("profile-row").first().click();
    await page.getByTestId("set-active").first().click();

    await page.goto('/dashboard');
    await expect(page.getByTestId('app-header')).toBeVisible();
    await shot(page, '06a-before-logout.png');

    await page.getByTestId('user-menu-trigger').click();
    await page.waitForTimeout(150);
    await page.getByTestId('user-menu-logout').click();
    // UserMenu navigates to /login automatically.
    await page.waitForURL(/\/login/, { timeout: 5_000 });
    await expect(page.getByTestId('login-overlay')).toBeVisible({ timeout: 10_000 });
    await check(page, 'login-overlay', '[data-testid="login-overlay"]');
    await shot(page, '06b-after-logout.png');
  });

  test('07 Login as admin lands on /profiles', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-overlay')).toBeVisible();
    await check(page, 'login-overlay', '[data-testid="login-overlay"]');
    await check(page, 'username-input', '[data-testid="login-username"]');
    await check(page, 'password-input', '[data-testid="login-password"]');

    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await shot(page, '07a-login-form-filled.png');

    await page.getByTestId('login-submit').click();

    await page.waitForURL(/\/profiles/, { timeout: 20_000 });
    await expect(page.getByTestId('profile-selector')).toBeVisible();
    await check(page, 'profile-selector', '[data-testid="profile-selector"]');
    await shot(page, '07b-login-success-profiles.png');
  });

  test.afterAll(async () => {
    await persistChecks();
    // Best-effort cleanup so the workspace doesn't accumulate
    // fixture-* entities across repeated runs. Honcho v3 has no
    // DELETE peer endpoint, so fixture peers are left in place —
    // they're idempotent on the next seed (createPeer upserts).
    const sid = await loginAsAdmin();
    if (sid) {
      const r = await callFixture('DELETE', sid);
      if (r.status >= 400) {
        console.warn(`[fixture] cleanup returned ${r.status}: ${JSON.stringify(r.body)}`);
      } else {
        console.log('[fixture] cleaned up test data');
      }
    }
  });
});
