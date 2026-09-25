import { expect, test } from '@playwright/test';

import { AppShellPage } from './pages/app-shell.page';

// Smoke journey: the app loads through Caddy with its runtime config from nginx.
test('the app loads over HTTPS and reaches the ready state', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const app = new AppShellPage(page);

  await app.open();

  await expect(app.title).toHaveText('Live-Faktencheck');
  await expect(app.emptyFeed).toBeVisible();
  await expect(app.configError).toHaveCount(0);
  // The strict CSP must not block anything the production bundle needs.
  expect(consoleErrors).toEqual([]);
});
