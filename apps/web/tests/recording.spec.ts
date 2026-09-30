// Stage 2b (T6.1–T6.3): live mode in real browsers against the mocked backend, with a synthetic
// microphone. The real audio path (AudioWorklet, resampling, framing) runs unchanged.
import { expect, test } from './fixtures';
import { RecordingPage } from './pages/recording.page';

/** 100 ms of PCM16 mono at 16 kHz (`AUDIO_FRAME_BYTES` in @lfc/contracts, whose build output
 * stage 2b does not have). */
const FRAME_BYTES = 3_200;

test.describe('live mode', () => {
  let recording: RecordingPage;

  test.beforeEach(async ({ page, backend: _backend }) => {
    recording = new RecordingPage(page);
    await recording.useSyntheticMicrophone();
    await recording.open();
    await expect(recording.start).toBeEnabled();
  });

  test('asks for consent with every cloud provider and records nothing on cancel', async ({
    backend,
    a11yViolations,
  }) => {
    await recording.start.click();
    await expect(recording.consentProviders).toHaveText([
      'Klassifikator: typesafe (jev-1.13.0)',
      'Spracherkennung: deepgram (nova-3)',
    ]);
    expect(await a11yViolations()).toEqual([]);
    await recording.cancel.click();
    await expect(recording.consent).toBeHidden();
    expect(backend.audioControls).toEqual([]);
    expect(backend.frameSizes).toEqual([]);
  });

  test('records: 100 ms PCM16 frames, live transcript, marked claim with verdict, stop', async ({
    backend,
    claims,
    a11yViolations,
  }) => {
    await recording.startRecording();
    await expect(recording.status).toHaveAttribute('data-status', 'recording');
    await expect.poll(() => backend.frameSizes.length).toBeGreaterThan(5);
    expect(new Set(backend.frameSizes)).toEqual(new Set([FRAME_BYTES]));

    await expect(recording.segments).toHaveCount(1);
    await expect(recording.segments.first()).toHaveAttribute('data-final', 'true');
    await expect(recording.segments.first()).toContainText('Sprecher B');
    const mark = recording.claimMarks.first();
    await expect(mark).toHaveAttribute('data-state', 'checked');
    await expect(mark).toContainText('Falsch');
    expect(await a11yViolations()).toEqual([]);

    await mark.click();
    await expect(claims.card('Der Zweite Weltkrieg endete 1965.')).toBeInViewport();

    await recording.stop.click();
    await expect(recording.start).toBeVisible();
    await expect(recording.end).toHaveCount(0);
    expect(backend.audioControls).toEqual(['audio.start', 'audio.stop']);
    const framesAtStop = backend.frameSizes.length;
    await expect.poll(() => backend.frameSizes.length, { timeout: 1_000 }).toBe(framesAtStop);
  });

  test('explains why the server ended the recording', async ({ backend }) => {
    await recording.startRecording();
    await expect(recording.status).toHaveAttribute('data-status', 'recording');
    backend.endRecording('budget_exceeded');
    await expect(recording.end).toContainText('Tagesbudget');
    await expect(recording.start).toBeVisible();
  });
});
