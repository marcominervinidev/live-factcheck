import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';

import { MockBackend, TEST_TOKEN } from './mock-backend';
import { AppShellPage } from './pages/app-shell.page';
import { ClaimsPage } from './pages/claims.page';

interface RuntimeConfigResponse {
  status: number;
  body: unknown;
}

interface Fixtures {
  /** What the mocked /config.json returns; override per test with test.use(). */
  runtimeConfig: RuntimeConfigResponse;
  app: AppShellPage;
  /** The gateway token already in localStorage (set on the settings page in real use); null: none. */
  token: string | null;
  /** Mocked gateway: WebSocket session, text mode and provider status. */
  backend: MockBackend;
  claims: ClaimsPage;
  /** Accessibility scan with axe; returns serious and critical violations. */
  a11yViolations: () => Promise<string[]>;
}

/**
 * The backend is the system boundary of the frontend (brief 13.1): /config.json and every
 * /api or /ws call are mocked, so the tests never depend on a running stack.
 */
export const test = base.extend<Fixtures>({
  runtimeConfig: [{ status: 200, body: { gatewayUrl: '/api' } }, { option: true }],

  app: async ({ page, runtimeConfig }, use) => {
    await page.route('**/config.json', (route) =>
      route.fulfill({ status: runtimeConfig.status, json: runtimeConfig.body }),
    );
    await page.route(/\/(api|ws)\//, (route) => route.fulfill({ status: 404, json: {} }));
    await use(new AppShellPage(page));
  },

  token: [TEST_TOKEN, { option: true }],

  // Depends on `app`: registered after its catch-all 404 route, so these routes win.
  backend: async ({ page, app: _app, token }, use) => {
    // nosemgrep: ajinabraham.njsscan.crypto.timing_attack_node.node_timing_attack -- null check, not a secret comparison
    if (token !== null) {
      await page.addInitScript((value) => {
        window.localStorage.setItem('lfc.gatewayToken', value);
      }, token);
    }
    const backend = new MockBackend(page);
    await backend.install();
    await use(backend);
  },

  claims: async ({ page, backend: _backend }, use) => {
    await use(new ClaimsPage(page));
  },

  a11yViolations: async ({ page }, use) => {
    await use(async () => {
      const result = await new AxeBuilder({ page }).analyze();
      return result.violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map((violation) => `${violation.id}: ${violation.help}`);
    });
  },
});

export { expect };
