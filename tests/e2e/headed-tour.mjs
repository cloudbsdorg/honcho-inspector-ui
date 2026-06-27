// Headed Playwright tour for the workspace UI. Logs in as admin
// and lands on /admin/overview (the first screen with data even
// on a fresh workspace). Holds the page open so the operator can
// interact.
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
  await page.waitForURL(/\/(profiles|admin)/, { timeout: 15_000 });
  console.log('[' + new Date().toISOString() + '] logged in, on ' + page.url());
  // Navigate to admin overview so we land on a screen with data
  await page.goto(`${BASE_URL}/admin/overview`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  console.log('[' + new Date().toISOString() + '] on admin overview; ready for operator interaction');
  // Hold the page open indefinitely. The operator Ctrl-C's this script.
  // setInterval keeps the event loop alive even though await is
  // hanging on a never-resolving promise.
  setInterval(() => {}, 1 << 30);
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
