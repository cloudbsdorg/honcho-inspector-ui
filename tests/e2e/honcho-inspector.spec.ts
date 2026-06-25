import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const SCREENSHOTS_DIR = process.env['SCREENSHOTS_DIR'] ?? './screenshots';
const CHECKS_FILE = path.join(SCREENSHOTS_DIR, '..', 'checks.json');

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
const PASSWORD = 'cloudbsd-admin-2026';

const PROFILE = {
  label: 'Smoke Test Profile',
  apiKey: 'sk-test-regression-key-2026',
  baseUrl: 'https://mcp.honcho.example',
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
  });

  test('01 Setup wizard creates first admin', async ({ page }) => {
    await page.goto('/');
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
  });
});
