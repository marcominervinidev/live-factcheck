// Local HTTP server that plays a provider's API at the system boundary (brief 13.1: mocks only at
// system boundaries). Tests only; not exported from the package.
import { createServer } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

export interface FakeResponse {
  readonly status?: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

export interface FakeServer {
  readonly url: string;
  readonly requests: RecordedRequest[];
  /** Queue the next responses in order; when the queue is empty the server answers 500. */
  respond(...responses: FakeResponse[]): void;
  close(): Promise<void>;
}

export async function startFakeServer(): Promise<FakeServer> {
  const queue: FakeResponse[] = [];
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body: raw === '' ? undefined : (JSON.parse(raw) as unknown),
      });
      const next = queue.shift() ?? { status: 500, body: { error: 'no fake response queued' } };
      const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
      res.writeHead(next.status ?? 200, {
        'content-type': 'application/json',
        ...next.headers,
      });
      res.end(text);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    respond: (...responses) => {
      queue.push(...responses);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      }),
  };
}

/** A Claude Messages API answer with one text block. */
export function anthropicMessage(
  text: string,
  stopReason: 'end_turn' | 'max_tokens' | 'refusal' = 'end_turn',
  usage = { input_tokens: 100, output_tokens: 20 },
): FakeResponse {
  return {
    body: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content: [{ type: 'text', text }],
      stop_reason: stopReason,
      stop_sequence: null,
      usage,
    },
  };
}

/** An OpenAI-compatible chat completion with one choice. */
export function chatCompletion(
  content: string | null,
  finishReason: 'stop' | 'length' = 'stop',
  usage = { prompt_tokens: 80, completion_tokens: 15, total_tokens: 95 },
): FakeResponse {
  return {
    body: {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 0,
      model: 'local-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
      usage,
    },
  };
}
