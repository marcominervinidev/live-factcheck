import { defineConfig, devices } from '@playwright/test';

// Stage 2b (brief 13.2): the real app in real browsers against a mocked backend.
// Runs in the official Playwright image (browsers included), locally and in CI.
const CI = process.env['CI'] === 'true';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: CI,
  // Retries only in CI and at most once (brief 13.1); flaky tests are fixed, not hidden.
  retries: CI ? 1 : 0,
  reporter: CI
    ? [
        ['list'],
        ['junit', { outputFile: '../reports/junit.xml' }],
        ['html', { open: 'never', outputFolder: '../playwright-report' }],
      ]
    : [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  outputDir: '../test-results',
  use: {
    // The UI follows the device language (T6.6); the suites assert German texts, the
    // dedicated English spec overrides per test.
    locale: 'de-DE',
    baseURL: 'http://127.0.0.1:4173',
    // CI records every test (trace, video, screenshot) so the owner can review the run from the
    // HTML report attached to each PR; locally only what is needed to debug a retry.
    trace: CI ? 'on' : 'on-first-retry',
    video: CI ? 'on' : 'off',
    screenshot: CI ? 'on' : 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
    // WebKit is the engine of Safari; the real iPhone is covered by a manual smoke test (13.6).
    { name: 'webkit-iphone', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command:
      'node_modules/.bin/vite build --logLevel warn && node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort',
    cwd: '..',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
