// Stage 4 (brief 13.2): the critical text-mode journey through Caddy against the whole stack
// (mock providers). The user enters the token on the settings page, types a claim and sees the
// verdict before the explanation.
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- read from the secret file
const TOKEN = readFileSync(
  process.env['GATEWAY_TOKEN_FILE'] ?? '/run/secrets/gateway_token',
  'utf8',
).trim();
const CLAIM = 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei.';

test('text mode: token, claim, verdict, then explanation', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/');
  await expect(page.getByTestId('no-token')).toBeVisible();

  await page.getByTestId('nav-settings').click();
  await page.getByTestId('token-input').fill(TOKEN);
  await page.getByTestId('token-save').click();
  await expect(page.getByTestId('provider').first()).toBeVisible();

  await page.getByTestId('nav-check').click();
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'open');

  await page.getByTestId('claim-input').fill(CLAIM);
  await page.getByTestId('claim-submit').click();

  const card = page.getByTestId('claim-card').filter({ hasText: CLAIM });
  await expect(card.getByTestId('verdict-chip')).toHaveText(/Falsch/, { timeout: 30_000 });
  await expect(card.getByTestId('badge-existing')).toBeVisible();
  await expect(card.getByTestId('best-evidence')).toContainText('1945');
  await expect(card.getByTestId('explanation')).toHaveText(
    'Testerklärung: Die Behauptung ist falsch.',
    { timeout: 30_000 },
  );
  await expect(card.getByTestId('disclaimer')).toBeVisible();
  await expect(page.getByTestId('timeline-dot')).toHaveCount(1);

  // The token never appears in a URL (brief 15.5), and the strict CSP blocks nothing.
  expect(page.url()).not.toContain(TOKEN);
  expect(consoleErrors).toEqual([]);
});
