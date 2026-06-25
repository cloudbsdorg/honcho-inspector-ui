/**
 * Playwright config for the Honcho Inspector 9-screen regression.
 *
 * Single chromium project, headless mode. The UI is captured as full-page
 * screenshots + HTML snapshots, not actual rendered pixels — the GPU is
 * irrelevant.
 *
 * Configurable via env:
 *   BASE_URL          default http://localhost:4200
 *   SCREENSHOTS_DIR   default ./screenshots   (relative to tests/e2e/)
 *
 * Invoked as:  cd tests/e2e && npx playwright test
 */
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:4200';
const SCREENSHOTS_DIR = process.env['SCREENSHOTS_DIR'] ?? './screenshots';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',

  // One worker, one browser context: localStorage (and thus the
  // session) persists across tests, exactly like a real user clicking
  // through the app in order.
  fullyParallel: false,
  workers: 1,

  retries: 0,

  // 60s covers the cold Angular dev-server compile on the very
  // first /setup hit; everything after is well under 5s.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],

  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1366, height: 900 },
    // Self-signed cert in some smoke profiles; TLS-terminating reverse
    // proxy in others. Either way, don't let cert errors fail us.
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    // Screenshots are taken explicitly per step (fullPage: true);
    // 'only-on-failure' just catches anything we forgot to capture.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Don't pin a Chrome channel — let Playwright's bundled
        // Chromium do the work. The smoke stack is headless.
        channel: undefined,
      },
    },
  ],

  outputDir: 'test-results',
});
