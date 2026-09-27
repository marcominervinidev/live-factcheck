import type { Locator, Page } from '@playwright/test';

/** Page object for the app shell; selectors are data-testid or accessible roles only. */
export class AppShellPage {
  readonly shell: Locator;
  readonly title: Locator;
  readonly emptyFeed: Locator;
  readonly configError: Locator;

  constructor(private readonly page: Page) {
    this.shell = page.getByTestId('app-shell');
    this.title = page.getByRole('heading', { level: 1 });
    this.emptyFeed = page.getByTestId('claims-empty');
    this.configError = page.getByTestId('config-error');
  }

  async open(): Promise<void> {
    await this.page.goto('/');
  }

  /** True if the page scrolls horizontally, which breaks the mobile layout. */
  hasHorizontalOverflow(): Promise<boolean> {
    return this.page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  }
}
