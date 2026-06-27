// Drive the headed Chrome with remote debugging: log in, navigate
// to /inspector, click the mlapointe peer, send a chat message,
// and screenshot the results. This is the same as snap-peer.cjs
// but starts Chrome itself (no external dependency).
const { chromium } = require('@playwright/test');
const { spawn, execSync } = require('node:child_process');

const DEBUG_PORT = 9222;
const SCREEN_PEER = '/tmp/hi-services/peer-mlapointe.png';
const SCREEN_CHAT = '/tmp/hi-services/chat-with-markdown.png';

function killExistingChrome() {
  try {
    execSync('pkill -f "google-chrome" 2>/dev/null || true');
  } catch {}
}

async function main() {
  killExistingChrome();
  // Give the OS a moment to reap the dead processes
  await new Promise((r) => setTimeout(r, 2000));

  // Launch Chrome with the debug port
  const chromeProc = spawn(
    '/usr/bin/google-chrome',
    [
      '--remote-debugging-port=' + DEBUG_PORT,
      '--user-data-dir=/tmp/hi-services/chrome-profile',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,900',
      'http://127.0.0.1:4200/login',
    ],
    { detached: true, stdio: 'ignore' },
  );
  chromeProc.unref();
  console.log('chrome pid=' + chromeProc.pid);

  // Wait for the debug port
  let ws = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      ws = await chromium.connectOverCDP('http://127.0.0.1:' + DEBUG_PORT);
      if (ws.contexts().length > 0) break;
    } catch {}
    ws = null;
  }
  if (!ws) {
    console.error('failed to connect to Chrome devtools');
    process.exit(1);
  }
  console.log('connected to CDP');

  const ctx = ws.contexts()[0];
  const page = ctx.pages()[0];
  await page.setViewportSize({ width: 1440, height: 900 });

  // Login if needed
  if (page.url().includes('/login')) {
    await page.getByTestId('login-username').fill('admin');
    await page.getByTestId('login-password').fill('kEaUzUMh7gUjrapUgsDwG4Pb');
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/(profiles|admin|inspector)/, { timeout: 15_000 });
  }
  // Navigate to inspector
  await page.goto('http://127.0.0.1:4200/inspector', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  // Click the peers tab
  const peersTab = page.locator('[data-testid="tab-button"]', { hasText: 'peers' });
  if (await peersTab.count() > 0) {
    await peersTab.first().click();
    await page.waitForTimeout(500);
  }
  // Select mlapointe
  const peerSelect = page.locator('[data-testid="inspect-peer-select"]');
  if (await peerSelect.count() > 0) {
    await peerSelect.first().selectOption('mlapointe').catch(() => {});
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: SCREEN_PEER, fullPage: true });
  console.log('saved ' + SCREEN_PEER);

  // Open the chat pop-out
  const chatBtn = page.locator('[data-testid="open-chat-popout"]');
  if (await chatBtn.count() > 0) {
    await chatBtn.first().click();
    await page.waitForTimeout(800);
  }
  // Type a chat message that exercises markdown rendering
  const chatInput = page.locator('[data-testid="chat-input"]');
  if (await chatInput.count() > 0) {
    await chatInput.fill(
      'Show me a small example with a **bold word**, a `code snippet`, and a list:\n\n- first\n- second\n- third\n\nAnd a fenced code block:\n\n```python\nprint("hello world")\n```\n'
    );
    await page.keyboard.press('Enter');
    // Wait for the assistant response
    await page.waitForTimeout(8000);
  }
  await page.screenshot({ path: SCREEN_CHAT, fullPage: true });
  console.log('saved ' + SCREEN_CHAT);

  // Dump page text for debugging
  const pageText = await page.locator('body').textContent().catch(() => '');
  console.log('---page text excerpt---');
  console.log((pageText || '').slice(0, 1500));

  await ws.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
