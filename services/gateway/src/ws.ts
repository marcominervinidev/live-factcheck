import type { WsErrorCode, WsServerMessage } from '@lfc/contracts';
import {
  EventEnvelope,
  WsClientMessage,
  WsServerMessage as WsServerMessageSchema,
} from '@lfc/contracts';
import websocket from '@fastify/websocket';
import type { HttpServer, Logger } from '@lfc/service-kit';

import { tokenMatches } from './auth.js';
import type { Config } from './config.js';
import type { SessionHub, SessionStore } from './sessions.js';

const MAX_MESSAGE_BYTES = 64 * 1024;

// Application close codes (4000–4999).
const CLOSE = {
  unauthorized: 4401,
  auth_timeout: 4408,
  invalid_message: 4400,
  session_expired: 4410,
  internal: 4500,
} as const;

const MESSAGES: Readonly<Record<WsErrorCode, string>> = {
  unauthorized: 'Missing or invalid token',
  auth_timeout: 'No auth message in time',
  invalid_message: 'The message is not valid',
  session_expired: 'The session has ended',
  internal: 'Internal error',
};

export interface WsDeps {
  readonly config: Config;
  readonly sessions: SessionStore;
  readonly hub: SessionHub;
  readonly logger: Logger;
}

/**
 * `/ws/session` (brief 6.1, 6.7; ADR 0010, 0011): the first message must authenticate within
 * WS_AUTH_TIMEOUT_MS; then the session is created and every event on its Pub/Sub channel is
 * forwarded. The connection ends after MAX_SESSION_MS.
 */
export async function registerWebSocket(app: HttpServer, deps: WsDeps): Promise<void> {
  await app.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });

  app.get('/ws/session', { websocket: true }, (socket) => {
    const { config, sessions, hub, logger } = deps;
    let sessionId: string | undefined;
    let closed = false;

    const send = (message: WsServerMessage) => {
      if (socket.readyState === socket.OPEN)
        socket.send(JSON.stringify(WsServerMessageSchema.parse(message)));
    };
    const fail = (code: WsErrorCode) => {
      send({ type: 'error', schemaVersion: 1, code, message: MESSAGES[code] });
      socket.close(CLOSE[code], code);
    };

    const authTimer = setTimeout(() => {
      fail('auth_timeout');
    }, config.WS_AUTH_TIMEOUT_MS);
    let sessionTimer: NodeJS.Timeout | undefined;

    let authenticating = false;
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      // Anything after the first message (also while the session is still being created) is
      // invalid, so one socket can never open several sessions (security review, phase 1).
      if (authenticating || sessionId !== undefined) {
        // Phase 1 has no client messages after auth; audio and control follow in phase 2.
        fail('invalid_message');
        return;
      }
      clearTimeout(authTimer);
      authenticating = true;
      let parsed: ReturnType<typeof WsClientMessage.safeParse> | undefined;
      try {
        parsed = isBinary
          ? undefined
          : WsClientMessage.safeParse(JSON.parse(data.toString('utf8')));
      } catch {
        parsed = undefined;
      }
      if (!parsed?.success) {
        fail('invalid_message');
        return;
      }
      if (!tokenMatches(config.GATEWAY_TOKEN, parsed.data.token)) {
        fail('unauthorized');
        return;
      }
      void (async () => {
        try {
          const id = await sessions.create();
          if (closed) {
            await sessions.end(id);
            return;
          }
          sessionId = id;
          await hub.join(id, (raw) => {
            let envelope: ReturnType<typeof EventEnvelope.safeParse> | undefined;
            try {
              envelope = EventEnvelope.safeParse(JSON.parse(raw));
            } catch {
              envelope = undefined;
            }
            if (envelope?.success) send({ type: 'event', schemaVersion: 1, event: envelope.data });
          });
          // Closed while subscribing: the close handler's leave may have run before the join.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set by the close handler during the await
          if (closed) {
            await hub.leave(id);
            return;
          }
          sessionTimer = setTimeout(() => {
            fail('session_expired');
          }, config.MAX_SESSION_MS);
          send({ type: 'session.ready', schemaVersion: 1, sessionId: id });
          logger.info({ sessionId: id }, 'session started');
        } catch (error) {
          logger.error({ err: error }, 'session start failed');
          fail('internal');
        }
      })();
    });

    socket.on('close', () => {
      closed = true;
      clearTimeout(authTimer);
      clearTimeout(sessionTimer);
      const id = sessionId;
      if (id === undefined) return;
      void hub
        .leave(id)
        .then(() => sessions.end(id))
        .then(() => {
          logger.info({ sessionId: id }, 'session ended');
        })
        .catch((error: unknown) => {
          logger.warn({ err: error, sessionId: id }, 'session cleanup failed');
        });
    });
  });
}
