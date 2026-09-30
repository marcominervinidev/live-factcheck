import { AUDIO_FRAME_BYTES, AUDIO_SAMPLE_RATE } from '@lfc/contracts';

const SAMPLES_PER_FRAME = AUDIO_FRAME_BYTES / 2;

/** Float sample in -1..1 to signed 16 bit, clipped. */
export function toInt16(sample: number): number {
  const clipped = Math.max(-1, Math.min(1, sample));
  return clipped < 0 ? Math.round(clipped * 0x8000) : Math.round(clipped * 0x7fff);
}

/**
 * Turns the microphone's float samples (any input rate, usually 44.1 or 48 kHz) into the one
 * format the pipeline accepts: PCM16 little-endian, mono, 16 kHz, in frames of 100 ms (ADR 0015).
 * Downsampling averages the input samples of each output sample, a simple low-pass that keeps
 * speech intelligible without aliasing artefacts. Stateful across calls, one instance per recording.
 */
export class Pcm16Encoder {
  private readonly ratio: number;
  private sum = 0;
  private count = 0;
  private consumed = 0;
  private produced = 0;
  private frame = new DataView(new ArrayBuffer(AUDIO_FRAME_BYTES));
  private frameSamples = 0;

  constructor(inputRate: number) {
    if (!Number.isFinite(inputRate) || inputRate < AUDIO_SAMPLE_RATE)
      throw new RangeError(`input rate ${String(inputRate)} is below ${String(AUDIO_SAMPLE_RATE)}`);
    this.ratio = inputRate / AUDIO_SAMPLE_RATE;
  }

  /** Adds input samples; returns every frame they complete (3200 bytes each). */
  push(input: Float32Array): ArrayBuffer[] {
    const frames: ArrayBuffer[] = [];
    for (const sample of input) {
      this.sum += sample;
      this.count += 1;
      this.consumed += 1;
      // The output sample n covers the input samples up to (n + 1) × ratio.
      if (this.consumed >= (this.produced + 1) * this.ratio) {
        this.frame.setInt16(this.frameSamples * 2, toInt16(this.sum / this.count), true);
        this.produced += 1;
        this.frameSamples += 1;
        this.sum = 0;
        this.count = 0;
        if (this.frameSamples === SAMPLES_PER_FRAME) {
          frames.push(this.frame.buffer);
          this.frame = new DataView(new ArrayBuffer(AUDIO_FRAME_BYTES));
          this.frameSamples = 0;
        }
      }
    }
    return frames;
  }
}
