// Headed Playwright tour — drives the full app with a real browser
// window visible to the operator. Holds the page open on the new
// /profiles two-pane layout so the operator can interact.
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:4200';
const PASSWORD = process.env.HONCHO_ADMIN_PASSWORD ?? 'kEaUzUMh7gUjrapUgsDwG4Pb';
const VIEWPORT = { width: 1440, height: 900 };

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  console.log('[' + new Date().toISOString() + '] opening login...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('login-username').fill('admin');
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/profiles/, { timeout: 15_000 });
  console.log('[' + new Date().toISOString() + '] on /profiles; selecting first connection in left aside');
  await page.waitForTimeout(1000);
  await page.locator('[data-testid="profile-row"]').first().click();
  await page.waitForTimeout(500);
  console.log('[' + new Date().toISOString() + '] details pane should show on the right');
  console.log('---');
  console.log('Browser is OPEN and visible on your desktop.');
  console.log('The new /profiles page has connections in the LEFT aside and');
  console.log('details in the RIGHT pane. Drive it interactively.');
  console.log('---');

  // Hold for 30 minutes (then auto-close)
  await page.waitForTimeout(30 * 60 * 1000);
  console.log('[' + new Date().toISOString() + '] auto-closing browser after 30 min');
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
