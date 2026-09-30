// Stage 4 (brief 13.2, 17; T7.1): the live-mode journey through Caddy against the whole stack
// with mock providers. A synthetic microphone feeds the real AudioWorklet path; the mock STT turns
// every 2 s of audio into the next script line, the second of which is a false claim.
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { LivePage } from './pages/live.page';

// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- read from the secret file
const TOKEN = readFileSync(
  process.env['GATEWAY_TOKEN_FILE'] ?? '/run/secrets/gateway_token',
  'utf8',
).trim();
const CLAIM = 'Der Zweite Weltkrieg endete 1965.';

test('live mode @dod: consent, live transcript, false claim marked and on a card', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const live = new LivePage(page);
  await live.useSyntheticMicrophone();
  await live.openWithToken(TOKEN);
  await expect(live.connection).toHaveAttribute('data-status', 'open');

  // No recording without consent.
  await live.start.click();
  await expect(live.consent).toBeVisible();
  await live.cancel.click();
  await expect(live.consent).toBeHidden();
  await expect(live.status).toHaveCount(0);

  await live.start.click();
  await live.accept.click();
  await expect(live.status).toHaveAttribute('data-status', 'recording', { timeout: 15_000 });

  // The transcript arrives live; the claim is marked and then shows its verdict.
  await expect(live.segments.first()).toBeVisible({ timeout: 15_000 });
  const mark = live.claimMarks.filter({ hasText: CLAIM });
  await expect(mark).toHaveAttribute('data-state', 'checked', { timeout: 30_000 });
  await expect(mark).toContainText('Falsch');

  await mark.click();
  const card = live.card(CLAIM);
  await expect(card).toBeInViewport();
  await expect(card.getByTestId('verdict-chip')).toHaveText(/Falsch/);

  await live.stop.click();
  await expect(live.start).toBeVisible({ timeout: 15_000 });
  expect(page.url()).not.toContain(TOKEN);
  expect(consoleErrors).toEqual([]);
});
