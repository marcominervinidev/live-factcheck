import type { Locator, Page } from '@playwright/test';

/** Page object for live mode: consent dialog, start/stop, recording status and live transcript. */
export class RecordingPage {
  readonly start: Locator;
  readonly stop: Locator;
  readonly status: Locator;
  readonly end: Locator;
  readonly consent: Locator;
  readonly consentProviders: Locator;
  readonly accept: Locator;
  readonly cancel: Locator;
  readonly segments: Locator;
  readonly claimMarks: Locator;

  constructor(private readonly page: Page) {
    this.start = page.getByTestId('record-start');
    this.stop = page.getByTestId('record-stop');
    this.status = page.getByTestId('recording-status');
    this.end = page.getByTestId('recording-end');
    this.consent = page.getByTestId('consent-dialog');
    this.consentProviders = page.getByTestId('consent-provider');
    this.accept = page.getByTestId('consent-accept');
    this.cancel = page.getByTestId('consent-cancel');
    this.segments = page.getByTestId('transcript-segment');
    this.claimMarks = page.getByTestId('transcript-claim');
  }

  /**
   * Replaces the microphone with a 440 Hz tone before the app loads, in every browser the same
   * way (Chromium's fake device does not exist in WebKit). Must run before `page.goto`.
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

  async open(): Promise<void> {
    await this.page.goto('/');
  }

  /** Opens the consent dialog, waits for the provider list and accepts. */
  async startRecording(): Promise<void> {
    await this.start.click();
    await this.consentProviders.first().waitFor();
    await this.accept.click();
  }
}
