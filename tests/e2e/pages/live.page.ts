import type { Locator, Page } from '@playwright/test';

/** Page object for live mode on the check page, plus the token step it needs first. */
export class LivePage {
  readonly connection: Locator;
  readonly start: Locator;
  readonly stop: Locator;
  readonly status: Locator;
  readonly consent: Locator;
  readonly accept: Locator;
  readonly cancel: Locator;
  readonly segments: Locator;
  readonly claimMarks: Locator;

  constructor(private readonly page: Page) {
    this.connection = page.getByTestId('connection-status');
    this.start = page.getByTestId('record-start');
    this.stop = page.getByTestId('record-stop');
    this.status = page.getByTestId('recording-status');
    this.consent = page.getByTestId('consent-dialog');
    this.accept = page.getByTestId('consent-accept');
    this.cancel = page.getByTestId('consent-cancel');
    this.segments = page.getByTestId('transcript-segment');
    this.claimMarks = page.getByTestId('transcript-claim');
  }

  /**
   * Replaces the microphone with a 440 Hz tone before the app loads, the same way in every
   * browser (same approach as apps/web/tests/pages/recording.page.ts). With the mock STT provider
   * the sound does not matter: every 2 s of audio become the next line of its script.
   */
  async useSyntheticMicrophone(): Promise<void> {
    await this.page.addInitScript(() => {
      // On the prototype: WebKit ignores a plain assignment on the instance.
      Object.defineProperty(MediaDevices.prototype, 'getUserMedia', {
        configurable: true,
        value: async () => {
          const context = new AudioContext();
          const tone = context.createOscillator();
          const destination = context.createMediaStreamDestination();
          tone.connect(destination);
          tone.start();
          await context.resume();
          return destination.stream;
        },
      });
    });
  }

  /** Opens the app, stores the gateway token like a user and returns to the check page. */
  async openWithToken(token: string): Promise<void> {
    await this.page.goto('/');
    await this.page.getByTestId('nav-settings').click();
    await this.page.getByTestId('token-input').fill(token);
    await this.page.getByTestId('token-save').click();
    await this.page.getByTestId('nav-check').click();
  }

  /** The card of a claim, found by its wording. */
  card(text: string): Locator {
    return this.page.getByTestId('claim-card').filter({ hasText: text });
  }
}
