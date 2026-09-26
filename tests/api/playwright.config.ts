import { defineConfig } from '@playwright/test';

// Stage 3 (brief 13.2): API tests against the stack started by Compose (mock providers only).
// No browser: every test uses Playwright's APIRequestContext.
const CI = process.env['CI'] === 'true';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['junit', { outputFile: 'reports/junit.xml' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: process.env['BASE_URL'] ?? 'https://lfc.local:8443',
    // Caddy's local CA is not trusted inside the test container.
    ignoreHTTPSErrors: true,
  },
});
