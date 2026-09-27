// Browser walk-through with screenshots at the decision points (brief 1.3, frontend evidence).
// Runs in the official Playwright image against a running stack, e.g. the isolated one:
//   docker run --rm --add-host lfc.local:host-gateway -v "$PWD":/workspace \
//     -e BASE_URL=https://lfc.local:8444 -e GATEWAY_TOKEN_FILE=/token \
//     -v <token file>:/token:ro mcr.microsoft.com/playwright:v1.63.0-noble \
//     sh -c 'cd /workspace/tests/e2e && node scripts/ui-screens.mjs'
// Screenshots land in docs/evidence/phase-1/screens/. Mock providers only.
import { mkdirSync, readFileSync } from 'node:fs';

import { chromium, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://lfc.local:8443';
const TOKEN = readFileSync(process.env.GATEWAY_TOKEN_FILE ?? '/token', 'utf8').trim();
const OUT = '/workspace/docs/evidence/phase-1/screens';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 15'], ignoreHTTPSErrors: true });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

await page.goto(BASE_URL);
await page.getByTestId('no-token').waitFor();
await shot('01-start-without-token');

await page.getByTestId('nav-settings').click();
await page.getByTestId('token-input').fill(TOKEN);
await page.getByTestId('token-save').click();
await page.getByTestId('provider').first().waitFor();
await shot('02-settings-providers');

await page.getByTestId('nav-check').click();
await page.locator('[data-testid="connection-status"][data-status="open"]').waitFor();
await page.getByTestId('claim-input').fill('Der Zweite Weltkrieg ist erst 20 Jahre vorbei.');
await page.getByTestId('claim-submit').click();
await page.getByTestId('verdict-chip').first().waitFor({ timeout: 30_000 });
await page.getByText('Testerklärung', { exact: false }).first().waitFor({ timeout: 30_000 });
await shot('03-verdict-and-explanation');

for (const text of [
  'Berlin hat 3,9 Millionen Einwohner.',
  'Ich finde, Berlin ist die schönste Stadt.',
]) {
  await page.getByTestId('claim-input').fill(text);
  await page.getByTestId('claim-submit').click();
}
await page.locator('[data-testid="verdict-chip"]').nth(2).waitFor({ timeout: 30_000 });
await page.getByTestId('distribution').first().locator('summary').click();
await shot('04-feed-uncertain-opinion-distribution');

console.log(JSON.stringify({ consoleErrors, screens: 4 }));
await browser.close();
