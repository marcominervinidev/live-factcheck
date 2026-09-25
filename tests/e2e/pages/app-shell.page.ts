import type { Locator, Page } from '@playwright/test';

/** Page object for the app shell (same selectors as the stage 2b page object). */
export class AppShellPage {
  readonly title: Locator;
  readonly emptyFeed: Locator;
  readonly configError: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByRole('heading', { level: 1 });
    this.emptyFeed = page.getByTestId('claims-empty');
    this.configError = page.getByTestId('config-error');
  }

  async open(): Promise<void> {
    await this.page.goto('/');
  }
}
