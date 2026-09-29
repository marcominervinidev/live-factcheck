import type { TranscriptSegment } from '@lfc/contracts';
import { STREAMS } from '@lfc/contracts';
import websocket from '@fastify/websocket';
import type { DailyBudget, SttProvider } from '@lfc/providers';
import type { HttpServer, Logger } from '@lfc/service-kit';
import { publishEvent, publishToSession } from '@lfc/service-kit';
import type { Redis } from 'ioredis';

import { handleRecording } from './recording.js';

/** Frames are at most 8 KiB (ADR 0015); control messages are tiny. */
const MAX_MESSAGE_BYTES = 16 * 1024;

export interface AudioRouteDeps {
  readonly redis: Redis;
  readonly stt: SttProvider;
  readonly budget: DailyBudget | undefined;
  readonly maxBufferedBytes: number;
  readonly logger: Logger;
}

/**
 * Internal WebSocket `/v1/audio` for the gateway (network `internal` only, ADR 0015): one
 * connection per recording.
 */
export async function registerAudioRoute(app: HttpServer, deps: AudioRouteDeps): Promise<void> {
  await app.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });
  const event = (payload: TranscriptSegment) =>
    ({ type: 'transcript.segment', schemaVersion: 2, payload }) as const;

  app.get('/v1/audio', { websocket: true }, (socket) => {
    handleRecording(socket, {
      stt: deps.stt,
      budget: deps.budget,
      maxBufferedBytes: deps.maxBufferedBytes,
      logger: deps.logger,
      publishFinal: async (segment) => {
        await publishEvent(deps.redis, STREAMS.transcriptSegments, event(segment), {
          toSession: true,
        });
      },
      publishInterim: (segment) => publishToSession(deps.redis, event(segment)),
    });
  });
}
