import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const SCREENSHOTS_DIR = process.env['SCREENSHOTS_DIR'] ?? './screenshots';

const USERNAME = 'admin';
const PASSWORD = 'cloudbsd-admin-2026';

const PROFILE = {
  label: 'Smoke Test Profile',
  apiKey: 'sk-test-regression-key-2026',
  baseUrl: 'https://mcp.honcho.example',
  workspaceId: 'default',
  honchoUserName: 'admin',
} as const;

const test = base.extend<{}, { sharedContext: BrowserContext }>({
  sharedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  page: async ({ sharedContext }, use) => {
    const page = await sharedContext.newPage();
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
    await shot(page, '01a-setup-step1-welcome.png');
    await page.getByTestId('setup-next').click();

    await expect(page.getByTestId('setup-step-2')).toBeVisible();
    await page.getByTestId('setup-username').fill(USERNAME);
    await page.getByTestId('setup-password').fill(PASSWORD);
    await page.getByTestId('setup-confirm').fill(PASSWORD);
    await shot(page, '01b-setup-step2-filled.png');
    await page.getByTestId('setup-next').click();

    await expect(page.getByTestId('setup-step-3')).toBeVisible();
    await shot(page, '01c-setup-step3-confirm.png');
    await page.getByTestId('setup-confirm-btn').click();

    await page.waitForURL(/\/profiles/, { timeout: 20_000 });
    await expect(page.getByTestId('profile-selector')).toBeVisible();
    await shot(page, '01d-setup-complete-profiles.png');
  });

  test('02 Profile create submits and shows Active badge', async ({ page }) => {
    await page.goto('/profiles');
    await expect(page.getByTestId('profile-selector')).toBeVisible();
    await shot(page, '02a-profiles-empty.png');

    await page.getByTestId('new-profile-button').click();
    await expect(page.getByTestId('profile-form')).toBeVisible();

    await page.getByTestId('profile-label').fill(PROFILE.label);
    await page.getByTestId('profile-apikey').fill(PROFILE.apiKey);
    await page.getByTestId('profile-baseurl').fill(PROFILE.baseUrl);
    await page.getByTestId('profile-workspaceid').fill(PROFILE.workspaceId);
    await page.getByTestId('profile-honchousername').fill(PROFILE.honchoUserName);
    await shot(page, '02b-profile-form-filled.png');

    await page.getByTestId('profile-save').click();

    await expect(page.getByTestId('profile-form')).toBeHidden({
      timeout: 15_000,
    });
    await expect(page.getByText(PROFILE.label)).toBeVisible();
    await expect(page.getByTestId('active-badge')).toBeVisible();
    await shot(page, '02c-profile-active.png');
  });

  test('03 Dashboard renders peers sidebar', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('app-header')).toBeVisible();
    await expect(page.getByTestId('dashboard')).toBeVisible();

    await expect(page.getByText(/^Peers \(\d+\)$/)).toBeVisible();
    await page.waitForTimeout(1500);
    await shot(page, '03-dashboard.png');
  });

  const INSPECTOR_TABS = [
    'workspace',
    'peers',
    'sessions',
    'conclusions',
    'search',
  ] as const;

  for (const tabId of INSPECTOR_TABS) {
    test(`04 Inspector · ${tabId} tab`, async ({ page }) => {
      await page.goto('/inspector');
      await expect(page.getByTestId('memory-inspector')).toBeVisible();

      await page.locator(`[data-tab-id="${tabId}"]`).click();
      await expect(page.getByTestId(`${tabId}-pane`)).toBeVisible();

      await page.waitForTimeout(800);
      await shot(page, `04-inspector-${tabId}.png`);
    });
  }

  const ADMIN_TABS = [
    'overview',
    'users',
    'audit',
    'maintenance',
  ] as const;

  for (const tabId of ADMIN_TABS) {
    test(`05 Admin · ${tabId} tab`, async ({ page }) => {
      await page.goto('/admin');
      await expect(page.getByTestId('admin-page')).toBeVisible();

      await page.getByTestId(`admin-tab-${tabId}`).click();
      await expect(page.getByTestId(`admin-${tabId}`)).toBeVisible();

      await page.waitForTimeout(800);
      await shot(page, `05-admin-${tabId}.png`);
    });
  }

  test('06 Header logout clears session and ends on /login', async ({
    page,
  }) => {
    await page.goto('/inspector');
    await expect(page.getByTestId('app-header')).toBeVisible();
    await shot(page, '06a-before-logout.png');

    await page.getByTestId('logout-button').click();

    await page.waitForFunction(
      () => localStorage.getItem('honcho-credentials') === null,
      undefined,
      { timeout: 10_000 },
    );

    if (!/\/login/.test(page.url())) {
      await page.goto('/admin');
    }
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-overlay')).toBeVisible();
    await shot(page, '06b-after-logout.png');
  });

  test('07 Login as admin lands on /profiles', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-overlay')).toBeVisible();

    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await shot(page, '07a-login-form-filled.png');

    await page.getByTestId('login-submit').click();

    await page.waitForURL(/\/profiles/, { timeout: 20_000 });
    await expect(page.getByTestId('profile-selector')).toBeVisible();
    await shot(page, '07b-login-success-profiles.png');
  });
});
