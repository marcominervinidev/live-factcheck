import { AUDIO_FRAME_BYTES } from '@lfc/contracts';
import { describe, expect, it } from 'vitest';

import { Pcm16Encoder, toInt16 } from './pcm';

const samples = (count: number, value: (i: number) => number) =>
  Float32Array.from({ length: count }, (_, i) => value(i));

const int16s = (frame: ArrayBuffer) => {
  const view = new DataView(frame);
  return Array.from({ length: frame.byteLength / 2 }, (_, i) => view.getInt16(i * 2, true));
};

describe('toInt16', () => {
  it('maps -1..1 to the full signed 16 bit range and clips beyond', () => {
    expect([toInt16(-1), toInt16(0), toInt16(1)]).toEqual([-32768, 0, 32767]);
    expect([toInt16(-3), toInt16(2)]).toEqual([-32768, 32767]);
    expect(toInt16(0.5)).toBe(16384);
  });
});

describe('Pcm16Encoder', () => {
  it('turns 100 ms at 48 kHz into exactly one 100 ms frame at 16 kHz', () => {
    const encoder = new Pcm16Encoder(48_000);
    const frames = encoder.push(samples(4_800, () => 0.25));
    expect(frames).toHaveLength(1);
    expect(frames[0]?.byteLength).toBe(AUDIO_FRAME_BYTES);
    expect(new Set(int16s(frames[0] ?? new ArrayBuffer(0)))).toEqual(new Set([8192]));
  });

  it('keeps its state across calls, whatever the chunk size', () => {
    const whole = new Pcm16Encoder(48_000).push(samples(9_600, (i) => Math.sin(i / 20)));
    const chunked = new Pcm16Encoder(48_000);
    const frames: ArrayBuffer[] = [];
    for (let start = 0; start < 9_600; start += 128)
      frames.push(...chunked.push(samples(128, (i) => Math.sin((start + i) / 20))));
    expect(frames.map(int16s)).toEqual(whole.map(int16s));
  });

  it('downsamples 44.1 kHz without drifting: one second gives ten frames', () => {
    const encoder = new Pcm16Encoder(44_100);
    const frames = encoder.push(samples(44_100, () => -0.5));
    expect(frames).toHaveLength(10);
    expect(int16s(frames[9] ?? new ArrayBuffer(0)).every((s) => s === -16384)).toBe(true);
  });

  it('averages the input samples of each output sample (low-pass)', () => {
    // Alternating +1/-1 at 48 kHz is far above 8 kHz and must not survive as a tone.
    const frames = new Pcm16Encoder(48_000).push(samples(4_800, (i) => (i % 2 === 0 ? 1 : -1)));
    expect(Math.max(...int16s(frames[0] ?? new ArrayBuffer(0)).map(Math.abs))).toBeLessThan(11_000);
  });

  it('refuses an input rate below 16 kHz instead of upsampling silently', () => {
    expect(() => new Pcm16Encoder(8_000)).toThrow(RangeError);
  });
});
