import type { SttProvider, SttSession } from './types.js';

/**
 * Deterministic stand-in for a provider (brief 10, 13.1): the amount of audio drives a fixed
 * German script, so a WAV fixture in stage 3/4 always yields the same transcript. Every
 * `SECONDS_PER_LINE` of audio produce one interim segment halfway and one final segment at the
 * end of the line; speakers alternate A/B.
 */
export const MOCK_STT_SCRIPT = [
  'Guten Abend und willkommen zur Diskussion.',
  'Der Zweite Weltkrieg endete 1965.',
  'Das sehe ich anders, ich finde das Thema wichtig.',
  'Berlin hat ungefähr 3,9 Millionen Einwohner.',
  'Die Mondlandung fand 1975 statt.',
] as const;

const BYTES_PER_SECOND = 16_000 * 2;
export const MOCK_STT_SECONDS_PER_LINE = 2;

export function createMockSttProvider(model = 'mock'): SttProvider {
  return {
    name: 'mock',
    model,
    open(_options, handlers) {
      const lineBytes = BYTES_PER_SECOND * MOCK_STT_SECONDS_PER_LINE;
      let received = 0;
      let line = 0;
      let interimSent = false;
      let closed = false;

      const current = () => MOCK_STT_SCRIPT[line % MOCK_STT_SCRIPT.length] ?? '';
      const speaker = () => (line % 2 === 0 ? 'A' : 'B');
      const startMs = () => line * MOCK_STT_SECONDS_PER_LINE * 1_000;

      const session: SttSession = {
        send(frame) {
          if (closed) return;
          received += frame.byteLength;
          while (received >= (line + 1) * lineBytes) {
            handlers.onSegment({
              text: current(),
              isFinal: true,
              startMs: startMs(),
              endMs: startMs() + MOCK_STT_SECONDS_PER_LINE * 1_000,
              speaker: speaker(),
            });
            line += 1;
            interimSent = false;
          }
          if (!interimSent && received >= line * lineBytes + lineBytes / 2) {
            interimSent = true;
            const words = current().split(' ');
            handlers.onSegment({
              text: words.slice(0, Math.ceil(words.length / 2)).join(' '),
              isFinal: false,
              startMs: startMs(),
              endMs: startMs() + (MOCK_STT_SECONDS_PER_LINE * 1_000) / 2,
              speaker: speaker(),
            });
          }
        },
        bufferedBytes: 0,
        finish() {
          closed = true;
          return Promise.resolve();
        },
        abort() {
          closed = true;
        },
      };
      return Promise.resolve(session);
    },
  };
}
