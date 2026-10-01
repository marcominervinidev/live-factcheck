import type { Locator, Page } from '@playwright/test';

/** Page object for text mode, the claim feed, the timeline and the settings page. */
export class ClaimsPage {
  readonly input: Locator;
  readonly submit: Locator;
  readonly cards: Locator;
  readonly showView: Locator;
  readonly showBack: Locator;
  readonly summaryView: Locator;
  readonly summaryItems: Locator;
  readonly summaryNew: Locator;
  readonly summaryClose: Locator;
  readonly emptyFeed: Locator;
  readonly timelineDots: Locator;
  readonly connection: Locator;
  readonly noToken: Locator;

  constructor(private readonly page: Page) {
    this.input = page.getByTestId('claim-input');
    this.submit = page.getByTestId('claim-submit');
    this.cards = page.getByTestId('claim-card');
    this.timelineDots = page.getByTestId('timeline-dot');
    this.showView = page.getByTestId('show-view');
    this.showBack = page.getByTestId('show-back');
    this.summaryView = page.getByTestId('summary-view');
    this.summaryItems = page.getByTestId('summary-item');
    this.summaryNew = page.getByTestId('summary-new');
    this.summaryClose = page.getByTestId('summary-close');
    this.emptyFeed = page.getByTestId('claims-empty');
    this.connection = page.getByTestId('connection-status');
    this.noToken = page.getByTestId('no-token');
  }

  async open(): Promise<void> {
    await this.page.goto('/');
  }

  async check(text: string): Promise<void> {
    await this.input.fill(text);
    await this.submit.click();
  }

  /** The card for a claim text (newest cards come first). */
  card(text: string): Locator {
    return this.cards.filter({
      has: this.page.getByTestId('claim-text').getByText(text, { exact: true }),
    });
  }

  async openSettings(): Promise<void> {
    await this.page.getByTestId('nav-settings').click();
  }

  async saveToken(token: string): Promise<void> {
    await this.page.getByTestId('token-input').fill(token);
    await this.page.getByTestId('token-save').click();
  }
}
