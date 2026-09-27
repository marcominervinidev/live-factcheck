import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';

import { AppShellPage } from './pages/app-shell.page';

interface RuntimeConfigResponse {
  status: number;
  body: unknown;
}

interface Fixtures {
  /** What the mocked /config.json returns; override per test with test.use(). */
  runtimeConfig: RuntimeConfigResponse;
  app: AppShellPage;
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
