// AudioWorklet (ADR 0015): forwards the microphone's first channel to the page in batches, where
// `Pcm16Encoder` resamples and frames it. Runs in the AudioWorkletGlobalScope, not in the page.

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

/** About 85 ms at 48 kHz: fewer messages than one per 128-sample render quantum. */
const BATCH_SAMPLES = 4_096;

class CaptureProcessor extends AudioWorkletProcessor {
  private batch = new Float32Array(BATCH_SAMPLES);
  private filled = 0;
  /** The page sends 'stop' when the recording ends; returning false lets the browser drop us. */
  private active = true;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'stop') this.active = false;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!this.active || channel === undefined) return this.active;
    let offset = 0;
    while (offset < channel.length) {
      const take = Math.min(channel.length - offset, BATCH_SAMPLES - this.filled);
      this.batch.set(channel.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === BATCH_SAMPLES) {
        this.port.postMessage(this.batch, [this.batch.buffer]);
        this.batch = new Float32Array(BATCH_SAMPLES);
        this.filled = 0;
      }
    }
    return this.active;
  }
}

registerProcessor('lfc-capture', CaptureProcessor);
