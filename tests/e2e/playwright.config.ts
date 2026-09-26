import { defineConfig, devices } from '@playwright/test';

// Stage 4 (brief 13.2): few, critical user journeys against the real stack through Caddy.
const CI = process.env['CI'] === 'true';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Blob reports from every shard are merged into one HTML report in CI (brief 13.4).
  reporter: CI ? [['list'], ['blob'], ['junit', { outputFile: 'reports/junit.xml' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: process.env['BASE_URL'] ?? 'https://lfc.local:8443',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 15'] } },
    // Not part of the PR run (see pr.yml --project); the nightly run uses every project (brief 13.3).
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'] } },
  ],
});
