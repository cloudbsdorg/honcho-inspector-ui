// Drive the headed Chrome over CDP: log in, navigate to /inspector,
// select mlapointe, screenshot the result. Also screenshot the chat
// pop-out after clicking Chat.
const { chromium } = require('@playwright/test');

const SCREENSHOT_PEER = '/tmp/hi-services/peer-mlapointe.png';
const SCREENSHOT_CHAT = '/tmp/hi-services/chat-popout.png';

(async () => {
  const ws = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = ws.contexts()[0];
  const page = ctx.pages()[0];
  if (page.url().includes('/login')) {
    await page.getByTestId('login-username').fill('admin');
    await page.getByTestId('login-password').fill('kEaUzUMh7gUjrapUgsDwG4Pb');
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/(profiles|admin|inspector)/, { timeout: 15000 });
  }
  await page.goto('http://127.0.0.1:4200/inspector', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const peersTab = page.locator('[data-testid="tab-button"]', { hasText: 'peers' });
  if (await peersTab.count() > 0) {
    await peersTab.first().click();
    await page.waitForTimeout(500);
  }
  const peerSelect = page.locator('[data-testid="inspect-peer-select"]');
  if (await peerSelect.count() > 0) {
    await peerSelect.first().selectOption('mlapointe').catch(() => {});
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: SCREENSHOT_PEER, fullPage: true });
  console.log('saved', SCREENSHOT_PEER);
  // Click the pop-out for Representation
  const repPop = page.locator('[data-testid="popout-representation"]');
  if (await repPop.count() > 0) {
    await repPop.first().click();
    await page.waitForTimeout(500);
    console.log('--- after representation pop-out ---');
    const modal = await page.locator('[data-testid="popout-modal"]').isVisible().catch(() => false);
    console.log('popout-modal visible:', modal);
    await page.screenshot({ path: SCREENSHOT_CHAT, fullPage: true });
    console.log('saved', SCREENSHOT_CHAT);
    // Close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } else {
    console.log('popout-representation button NOT found');
  }
  // Now click Chat to test chat pop-out
  const chatBtn = page.locator('[data-testid="open-chat-popout"]');
  if (await chatBtn.count() > 0) {
    await chatBtn.first().click();
    await page.waitForTimeout(800);
    const chatModal = await page.locator('[data-testid="chat-popout-modal"]').isVisible().catch(() => false);
    console.log('chat-popout-modal visible:', chatModal);
    await page.screenshot({ path: SCREENSHOT_CHAT, fullPage: true });
    console.log('saved chat screenshot', SCREENSHOT_CHAT);
  } else {
    console.log('open-chat-popout button NOT found');
  }
  await ws.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
