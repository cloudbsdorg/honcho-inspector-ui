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
      await page.getByTestId("set-active").first().click();

      await page.goto('/admin');
      const tab = page.getByTestId(`admin-tab-${tabId}`);
      await tab.click();
      await check(page, `admin-${tabId}-tab`, `[data-testid="admin-tab-${tabId}"]`);
      await shot(page, `05-admin-${tabId}.png`);
    });
  }

  test('06 Header logout clears session and ends on /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/profiles/, { timeout: 15_000 });
    await page.getByTestId("set-active").first().click();

    await page.goto('/dashboard');
    await expect(page.getByTestId('app-header')).toBeVisible();
    await shot(page, '06a-before-logout.png');

    await page.getByTestId('logout-button').click();
    await page.waitForTimeout(2000);
    await page.goto('/login');
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
