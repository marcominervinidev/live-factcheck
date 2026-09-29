import WebSocket from 'ws';

import { SttError } from './types.js';

/**
 * Opens a WebSocket to a provider with headers (the WHATWG WebSocket in Node cannot send an
 * `Authorization` header, hence `ws`). HTTP 401/403 on the handshake becomes an `auth` error,
 * everything else before `open` a `connect` error. The key never appears in an error message.
 */
export function openSocket(
  url: string,
  headers: Readonly<Record<string, string>>,
  timeoutMs: number,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { ...headers }, handshakeTimeout: timeoutMs });
    const host = new URL(url).host;
    const fail = (error: SttError) => {
      socket.removeAllListeners();
      socket.on('error', () => undefined);
      socket.terminate();
      reject(error);
    };
    socket.once('open', () => {
      socket.removeAllListeners();
      resolve(socket);
    });
    socket.once('unexpected-response', (_request, response) => {
      const status = response.statusCode ?? 0;
      fail(
        status === 401 || status === 403
          ? new SttError('auth', `${host} rejected the credentials (HTTP ${String(status)})`)
          : new SttError('connect', `${host} refused the connection (HTTP ${String(status)})`),
      );
    });
    socket.once('error', (error) => {
      fail(new SttError('connect', `cannot connect to ${host}`, { cause: error }));
    });
  });
}

/** Resolves when the socket is closed, or after `timeoutMs` (then it is terminated). */
export function closed(socket: WebSocket, timeoutMs: number): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.terminate();
      resolve();
    }, timeoutMs);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Parses a text message as JSON; `undefined` for binary or malformed data. */
export function parseJson(data: WebSocket.RawData, isBinary: boolean): unknown {
  if (isBinary) return undefined;
  try {
    let buffer: Buffer;
    if (Buffer.isBuffer(data)) buffer = data;
    else if (Array.isArray(data)) buffer = Buffer.concat(data);
    else buffer = Buffer.from(data);
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Sends a keep-alive message when no audio went out for a while, so a provider does not close
 * the stream during a pause (Deepgram closes after ~10 s without data).
 */
export function keepAlive(
  socket: WebSocket,
  message: string,
  lastSentAt: () => number,
  intervalMs = 5_000,
): () => void {
  const timer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN && Date.now() - lastSentAt() >= intervalMs - 500) {
      socket.send(message);
    }
  }, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
