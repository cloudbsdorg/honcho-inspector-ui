import { chromium } from '@playwright/test';

const BASE_URL = process.env['BASE_URL'] ?? 'http://127.0.0.1:4200';
const USERNAME = process.env['HONCHO_ADMIN_USERNAME'] ?? 'admin';
const PASSWORD = process.env['HONCHO_ADMIN_PASSWORD'] ?? '';
if (!PASSWORD) {
  throw new Error(
    'HONCHO_ADMIN_PASSWORD env var is required (the password the bootstrap wrote to ' +
      '/etc/honcho-inspector/honcho.bootstrap.admin, or your smoke container password).',
  );
}

async function runSetupWizard(page: import('@playwright/test').Page) {
  console.log('[admin-overview-live] running setup wizard');
  await page.goto(`${BASE_URL}/`);
  await page.waitForURL(/\/setup/, { timeout: 30_000 });
  await page.getByTestId('setup-next').click();
  await page.getByTestId('setup-username').fill(USERNAME);
  await page.getByTestId('setup-password').fill(PASSWORD);
  await page.getByTestId('setup-confirm').fill(PASSWORD);
  await page.getByTestId('setup-next').click();
  await page.getByTestId('setup-confirm-btn').click();
  await page.waitForURL(/\/profiles/, { timeout: 30_000 });
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 200,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();

  page.on('request', (req) => {
    if (req.url().includes('/api/')) {
      console.log(`[req] ${req.method()} ${req.url()}`);
    }
  });
  page.on('response', async (resp) => {
    if (resp.url().includes('/api/')) {
      console.log(`[resp] ${resp.status()} ${resp.url()}`);
    }
  });
  page.on('console', (msg) => {
    console.log(`[browser:${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    console.log(`[pageerror] ${err.message}`);
  });

  // Seed backend state via API so we don't fight UI race conditions:
  // create admin + an extra user + log in via API for the X-Session-Id,
  // then have the UI log in via the form.
  await page.goto(`${BASE_URL}/`);
  const url = page.url();
  if (/\/setup/.test(url)) {
    await runSetupWizard(page);
  } else {
    console.log(`[admin-overview-live] logging in (existing user)`);
    await page.goto(`${BASE_URL}/login`);
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/profiles/, { timeout: 30_000 });
  }

  const sessionId = await page.evaluate(async ([baseUrl, username, password]) => {
    const r = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const d = await r.json();
    return d.sessionId;
  }, [BASE_URL, USERNAME, PASSWORD] as const);
  const createStatus = await page.evaluate(async ([baseUrl, sid]) => {
    const r = await fetch(`${baseUrl}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sid },
      body: JSON.stringify({
        label: 'Smoke Test Profile',
        apiKey: 'sk-test-regression-key-2026',
        baseUrl: 'https://honcho.example',
        workspaceId: 'default',
        honchoUserName: 'admin',
        active: true,
      }),
    });
    return r.status;
  }, [BASE_URL, sessionId]);
  console.log(`[admin-overview-live] profile create status=${createStatus}`);

  await page.reload();
  await page.waitForSelector('[data-testid="profile-row"]', { timeout: 15_000 });

  console.log('[admin-overview-live] selecting profile');
  const setActiveBtn = page.getByTestId('set-active').first();
  if ((await setActiveBtn.count()) > 0 && (await setActiveBtn.isEnabled())) {
    await setActiveBtn.click();
  } else {
    await page.locator(`[data-testid="profile-row"]`).first().click();
  }
  await page.waitForLoadState('networkidle');

  console.log(`[admin-overview-live] navigating to ${BASE_URL}/admin`);
  await page.goto(`${BASE_URL}/admin`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const bodyText = await page.locator('body').innerText();
  console.log(`[admin-overview-live] page body (first 800 chars):\n${bodyText.slice(0, 800)}`);

  await page.screenshot({ path: '/tmp/admin-overview-live.png', fullPage: true });
  console.log('[admin-overview-live] screenshot saved: /tmp/admin-overview-live.png');
  console.log('[admin-overview-live] taking screenshots of other tabs too');
  for (const tabId of ['users', 'audit', 'maintenance'] as const) {
    await page.getByTestId(`admin-tab-${tabId}`).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `/tmp/admin-${tabId}-live.png`, fullPage: true });
    console.log(`[admin-overview-live] saved /tmp/admin-${tabId}-live.png`);
  }
  console.log('[admin-overview-live] browser will stay open for 15 minutes. Close it from the window.');

  await new Promise((resolve) => {
    process.on('SIGINT', resolve);
    process.on('SIGTERM', resolve);
    setTimeout(resolve, 15 * 60 * 1000);
  });

  await context.close();
  await browser.close();
})();
