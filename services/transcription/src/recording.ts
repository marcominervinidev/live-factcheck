import { randomUUID } from 'node:crypto';

import type { AudioStopReason, TranscriptionStart, TranscriptSegment } from '@lfc/contracts';
import { TranscriptionClientMessage, TranscriptionServerMessage } from '@lfc/contracts';
import type { DailyBudget, SttProvider, SttSegment, SttSession } from '@lfc/providers';
import { BudgetExceededError, sttBudgetCostUsd } from '@lfc/providers';
import type { Logger } from '@lfc/service-kit';
import type WebSocket from 'ws';
import { germanNumberWordsToDigits } from './numbers.js';

/** Bytes of PCM16 mono audio per second at 16 kHz. */
const BYTES_PER_SECOND = 16_000 * 2;
/** Audio is booked against the daily budget in steps of this size (ADR 0015). */
const BOOKING_STEP_BYTES = 10 * BYTES_PER_SECOND;

export interface RecordingDeps {
  readonly stt: SttProvider;
  /** `undefined` for local and mock providers: they cost nothing (brief 15.5). */
  readonly budget: DailyBudget | undefined;
  readonly maxBufferedBytes: number;
  /** Final segments: to `transcript.segments` and the session channel. */
  publishFinal(segment: TranscriptSegment): Promise<void>;
  /** Interim segments: only to the session channel (brief 6.4). */
  publishInterim(segment: TranscriptSegment): Promise<void>;
  readonly logger: Logger;
}

/** Application close codes of the internal socket (4000–4999). */
const CLOSE_INVALID = 4400;

/**
 * One recording on the internal WebSocket `/v1/audio` (ADR 0015): `start`, binary PCM16 frames,
 * `stop`. Segments are published as they arrive; audio is never stored and transcript text is
 * never logged (brief 15.6).
 */
export function handleRecording(socket: WebSocket, deps: RecordingDeps): void {
  const { logger } = deps;
  let start: TranscriptionStart | undefined;
  let session: SttSession | undefined;
  let opening = false;
  let finished = false;
  // Read through a function after an await: the socket's close handler changes it meanwhile.
  const hasFinished = () => finished;
  let audioBytes = 0;
  let bookedBytes = 0;
  let segments = 0;
  // Interim segments share the id their final segment will get, so a client can replace them.
  let pendingId = randomUUID();

  const send = (message: TranscriptionServerMessage) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(TranscriptionServerMessage.parse(message)));
    }
  };

  // Fails closed: audio that cannot be booked or checked counts as a used-up budget.
  const book = async (force: boolean): Promise<boolean> => {
    if (deps.budget === undefined) return true;
    const unbooked = audioBytes - bookedBytes;
    if (unbooked <= 0 || (!force && unbooked < BOOKING_STEP_BYTES)) return true;
    bookedBytes = audioBytes;
    const audioMs = (unbooked / BYTES_PER_SECOND) * 1_000;
    try {
      await deps.budget.recordUsd(sttBudgetCostUsd(deps.stt.name, deps.stt.model, audioMs));
      await deps.budget.ensureAvailable();
      return true;
    } catch (error) {
      if (!(error instanceof BudgetExceededError))
        logger.warn({ sessionId: start?.sessionId, err: error }, 'could not book audio');
      return false;
    }
  };

  const stop = (reason: AudioStopReason) => {
    if (finished) return;
    finished = true;
    const context = { sessionId: start?.sessionId, recordingId: start?.recordingId };
    logger.info(
      {
        ...context,
        reason,
        audioMs: Math.round((audioBytes / BYTES_PER_SECOND) * 1_000),
        segments,
      },
      'recording stopped',
    );
    // The last booking's result does not change the reason: the audio is spent and the stream
    // closes either way. Failing closed happens where money would still be spent – on every
    // booking step while recording and before the next recording opens a stream.
    void book(true)
      .catch((error: unknown) => {
        logger.warn({ ...context, err: error }, 'could not book the last audio');
      })
      .finally(() => {
        if (start !== undefined)
          send({ type: 'stopped', schemaVersion: 1, recordingId: start.recordingId, reason });
        socket.close(1000);
      });
  };

  const toSegment = (segment: SttSegment, current: TranscriptionStart): TranscriptSegment => ({
    schemaVersion: 1,
    sessionId: current.sessionId,
    segmentId: pendingId,
    speaker: segment.speaker,
    // German number words become digits for the whole pipeline (numbers.ts).
    text: (current.language.startsWith('de')
      ? germanNumberWordsToDigits(segment.text)
      : segment.text
    ).slice(0, 10_000),
    startMs: segment.startMs,
    endMs: Math.max(segment.startMs, segment.endMs),
    isFinal: segment.isFinal,
    language: current.language,
  });

  const onSegment = (segment: SttSegment) => {
    const current = start;
    if (current === undefined || finished) return;
    const payload = toSegment(segment, current);
    if (segment.isFinal) {
      pendingId = randomUUID();
      segments += 1;
    }
    const publish = segment.isFinal ? deps.publishFinal(payload) : deps.publishInterim(payload);
    publish.catch((error: unknown) => {
      logger.warn(
        { sessionId: current.sessionId, segmentId: payload.segmentId, err: error },
        'could not publish a transcript segment',
      );
    });
  };

  const begin = async (message: TranscriptionStart) => {
    opening = true;
    start = message;
    const context = { sessionId: message.sessionId, recordingId: message.recordingId };
    try {
      await deps.budget?.ensureAvailable();
    } catch (error) {
      // Fails closed like `book`: an unknown budget never opens a paid stream.
      if (!(error instanceof BudgetExceededError))
        logger.warn({ ...context, err: error }, 'could not check the budget');
      stop('budget_exceeded');
      return;
    }
    // The gateway went away during the budget check: never open a paid stream for nobody.
    if (hasFinished()) return;
    try {
      session = await deps.stt.open(
        { language: message.language, sampleRate: message.sampleRate },
        {
          onSegment,
          onError: (error) => {
            logger.warn({ ...context, kind: error.kind, err: error }, 'speech-to-text failed');
            // Ended from our side too, whatever state the provider's connection is in.
            session?.abort();
            stop('provider_error');
          },
        },
      );
    } catch (error) {
      logger.warn({ ...context, err: error }, 'cannot open the speech-to-text stream');
      stop('provider_error');
      return;
    }
    if (hasFinished()) {
      // The gateway went away while the provider connected.
      session.abort();
      return;
    }
    opening = false;
    logger.info(
      { ...context, provider: deps.stt.name, model: deps.stt.model },
      'recording started',
    );
    send({ type: 'ready', schemaVersion: 1, recordingId: message.recordingId });
  };

  socket.on('message', (data: Buffer, isBinary: boolean) => {
    if (finished) return;
    if (isBinary) {
      // Audio before `ready` is a protocol error of the gateway, not a reason to buffer it.
      if (session === undefined) {
        socket.close(CLOSE_INVALID, 'audio before ready');
        finished = true;
        return;
      }
      audioBytes += data.byteLength;
      session.send(data);
      if (session.bufferedBytes > deps.maxBufferedBytes) {
        session.abort();
        stop('overloaded');
        return;
      }
      void book(false).then((available) => {
        if (!available) {
          session?.abort();
          stop('budget_exceeded');
        }
      });
      return;
    }
    let parsed: ReturnType<typeof TranscriptionClientMessage.safeParse> | undefined;
    try {
      parsed = TranscriptionClientMessage.safeParse(JSON.parse(data.toString('utf8')));
    } catch {
      parsed = undefined;
    }
    if (!parsed?.success) {
      finished = true;
      socket.close(CLOSE_INVALID, 'invalid message');
      return;
    }
    const message = parsed.data;
    if (message.type === 'start') {
      if (start !== undefined || opening) {
        finished = true;
        socket.close(CLOSE_INVALID, 'already started');
        return;
      }
      void begin(message).catch((error: unknown) => {
        logger.error({ sessionId: message.sessionId, err: error }, 'recording start failed');
        stop('provider_error');
      });
      return;
    }
    // stop
    const current = session;
    if (current === undefined) {
      stop('client');
      return;
    }
    void current
      .finish()
      .catch((error: unknown) => {
        logger.warn(
          { sessionId: start?.sessionId, err: error },
          'speech-to-text did not finish cleanly',
        );
      })
      .finally(() => {
        stop('client');
      });
  });

  socket.on('close', () => {
    // The gateway closed (client gone): no more audio, no more cost.
    if (!finished) {
      session?.abort();
      finished = true;
      void book(true).catch((error: unknown) => {
        logger.warn({ sessionId: start?.sessionId, err: error }, 'could not book the last audio');
      });
      logger.info(
        { sessionId: start?.sessionId, recordingId: start?.recordingId, segments },
        'recording closed',
      );
    }
  });
}
