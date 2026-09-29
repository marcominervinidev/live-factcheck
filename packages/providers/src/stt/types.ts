import type { SttProviderName } from './config.js';

/** One piece of recognised speech. Times are relative to the start of the recording. */
export interface SttSegment {
  readonly text: string;
  /** Final segments enter the pipeline; interim ones only update the live transcript (brief 6.4). */
  readonly isFinal: boolean;
  readonly startMs: number;
  readonly endMs: number;
  /** `A`, `B`, … in order of appearance; always `A` without diarization. */
  readonly speaker: string;
}

export type SttErrorKind = 'connect' | 'auth' | 'protocol' | 'closed';

export class SttError extends Error {
  constructor(
    readonly kind: SttErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SttError';
  }
}

export interface SttHandlers {
  onSegment(segment: SttSegment): void;
  /** The stream failed; no further segments follow and the session is closed. */
  onError(error: SttError): void;
}

export interface SttOpenOptions {
  readonly language: string;
  readonly sampleRate: number;
}

export interface SttSession {
  /** Sends one PCM16 LE mono frame. Ignored after `finish` or `abort`. */
  send(frame: Uint8Array): void;
  /** Bytes queued for the provider but not yet sent (backpressure, ADR 0015). */
  readonly bufferedBytes: number;
  /** Flushes pending audio, delivers the last final segments, then closes. */
  finish(): Promise<void>;
  /** Closes at once without waiting for pending segments. */
  abort(): void;
}

export interface SttProvider {
  readonly name: SttProviderName;
  readonly model: string;
  /** Opens one streaming session per recording. Rejects with `SttError` if it cannot connect. */
  open(options: SttOpenOptions, handlers: SttHandlers): Promise<SttSession>;
}

/** Maps provider speaker ids (0, 1, … or labels) to `A`, `B`, … in order of appearance. */
export function speakerLabels(): (id: number | string | undefined) => string {
  const labels = new Map<number | string, string>();
  return (id) => {
    if (id === undefined) return 'A';
    const known = labels.get(id);
    if (known !== undefined) return known;
    // After Z the labels continue with A2, B2, …; 26 speakers are plenty for a conversation.
    const index = labels.size;
    const label = `${String.fromCodePoint(65 + (index % 26))}${index >= 26 ? String(Math.floor(index / 26) + 1) : ''}`;
    labels.set(id, label);
    return label;
  };
}
