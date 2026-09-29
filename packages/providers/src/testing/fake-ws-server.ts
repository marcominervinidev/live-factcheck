import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';

/**
 * A local WebSocket server standing in for a streaming STT provider in adapter tests (system
 * boundary, brief 13.1). It records the handshake and every message, and lets a test script the
 * provider's answers.
 */
export interface FakeWsConnection {
  readonly socket: WebSocket;
  readonly url: string;
  readonly headers: IncomingMessage['headers'];
  /** Text messages parsed as JSON, in order. */
  readonly json: unknown[];
  /** Total bytes of binary messages. */
  binaryBytes: number;
  sendJson(message: unknown): void;
}

export interface FakeWsServer {
  /** `ws://127.0.0.1:<port>`: a host for the adapters' host parameter. */
  readonly origin: string;
  readonly connections: FakeWsConnection[];
  /** Resolves with the next (or an already open, unused) connection. */
  nextConnection(): Promise<FakeWsConnection>;
  close(): Promise<void>;
}

export async function startFakeWsServer(options: { readonly rejectStatus?: number } = {}) {
  const server = new WebSocketServer({
    port: 0,
    host: '127.0.0.1',
    verifyClient: (_info, done) => {
      if (options.rejectStatus === undefined) done(true);
      else done(false, options.rejectStatus);
    },
  });
  await new Promise<void>((resolve) =>
    server.once('listening', () => {
      resolve();
    }),
  );
  const connections: FakeWsConnection[] = [];
  const waiting: ((connection: FakeWsConnection) => void)[] = [];
  let handedOut = 0;

  server.on('connection', (socket, request) => {
    const connection: FakeWsConnection = {
      socket,
      url: request.url ?? '',
      headers: request.headers,
      json: [],
      binaryBytes: 0,
      sendJson: (message) => {
        socket.send(JSON.stringify(message));
      },
    };
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        connection.binaryBytes += Buffer.isBuffer(data) ? data.byteLength : 0;
        return;
      }
      connection.json.push(JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : '{}'));
    });
    connections.push(connection);
    const waiter = waiting.shift();
    if (waiter !== undefined) {
      handedOut += 1;
      waiter(connection);
    }
  });

  const { port } = server.address() as AddressInfo;
  const fake: FakeWsServer = {
    origin: `ws://127.0.0.1:${String(port)}`,
    connections,
    nextConnection: () => {
      const ready = connections[handedOut];
      if (ready !== undefined) {
        handedOut += 1;
        return Promise.resolve(ready);
      }
      return new Promise((resolve) => waiting.push(resolve));
    },
    close: () =>
      new Promise((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => {
          resolve();
        });
      }),
  };
  return fake;
}
