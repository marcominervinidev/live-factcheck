// SSRF guard at connection level (plan T3.1, brief 15.5). The fake server listens on 127.0.0.1,
// which the production policy blocks; the test policy allows exactly that one address so the
// happy path can run, while every attack case still has to be refused.
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { NetworkPolicy } from './address.js';
import { isPublicAddress } from './address.js';
import type { Resolver } from './safe-fetch.js';
import { FetchBlockedError, FetchFailedError, createSafeFetcher } from './safe-fetch.js';

let port = 0;
let server: ReturnType<typeof createServer>;
const hits: string[] = [];

const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void> = {
  '/page': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body><p>Der Zweite Weltkrieg endete 1945.</p></body></html>');
  },
  '/latin1': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=iso-8859-1' });
    res.end(Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65])); // "Grüße"
  },
  '/redirect-internal': (_req, res) => {
    res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
    res.end();
  },
  '/redirect-hostname': (_req, res) => {
    res.writeHead(301, { location: 'http://redis:6379/' });
    res.end();
  },
  '/redirect-ok': (_req, res) => {
    res.writeHead(307, { location: '/page' });
    res.end();
  },
  '/loop': (_req, res) => {
    res.writeHead(302, { location: '/loop' });
    res.end();
  },
  '/big': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('x'.repeat(5_000));
  },
  '/big-chunked': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' }); // no content-length
    for (let i = 0; i < 10; i++) res.write('y'.repeat(1_000));
    res.end();
  },
  '/pdf': (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/pdf' });
    res.end('%PDF');
  },
  '/slow': (_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('late');
    }, 2_000);
  },
  '/echo-key': (req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(String(req.headers['x-api-key'] ?? 'none'));
  },
  '/redirect-same-origin': (_req, res) => {
    res.writeHead(302, { location: '/echo-key' });
    res.end();
  },
  '/redirect-other-origin': (_req, res) => {
    res.writeHead(302, { location: `http://other.test:${String(port)}/echo-key` });
    res.end();
  },
  '/ua': (req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(req.headers['user-agent'] ?? '');
  },
};

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '');
    const route = routes[req.url ?? ''];
    if (route === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    route(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
});

/** Test DNS: public-looking names map to our fake server; others to attack targets. */
const dnsTable: Record<string, { address: string; family: 4 | 6 }[]> = {
  'site.test': [{ address: '127.0.0.1', family: 4 }],
  'other.test': [{ address: '127.0.0.1', family: 4 }],
  'metadata.attacker.test': [{ address: '169.254.169.254', family: 4 }],
  'mixed.attacker.test': [
    { address: '127.0.0.1', family: 4 },
    { address: '10.0.0.5', family: 4 },
  ],
  'nothing.test': [],
};
const resolve: Resolver = (hostname) => Promise.resolve(dnsTable[hostname] ?? []);

// Allows exactly the fake server; everything else is judged by the production rule.
const testPolicy = (): NetworkPolicy => ({
  allowedPorts: new Set([80, 443, port]),
  isAllowedAddress: (address) => address === '127.0.0.1' || isPublicAddress(address),
});

const fetcher = (overrides: { maxBytes?: number; timeoutMs?: number } = {}) =>
  createSafeFetcher({
    userAgent: 'live-factcheck/test (+https://github.com/marcominervinidev/live-factcheck)',
    timeoutMs: overrides.timeoutMs ?? 1_000,
    maxBytes: overrides.maxBytes ?? 100_000,
    policy: testPolicy(),
    resolve,
  });

const at = (path: string, host = 'site.test') => `http://${host}:${String(port)}${path}`;
const html = ['text/html'];

describe('safe fetch', () => {
  it('fetches a page through the pinned, validated address', async () => {
    const page = await fetcher().fetchText(at('/page'), { accept: html });
    expect(page).toMatchObject({ status: 200, contentType: 'text/html', url: at('/page') });
    expect(page.text).toContain('1945');
  });

  it('decodes the declared charset', async () => {
    const page = await fetcher().fetchText(at('/latin1'), { accept: ['text/plain'] });
    expect(page.text).toBe('Grüße');
  });

  it('sends its own User-Agent', async () => {
    const page = await fetcher().fetchText(at('/ua'), { accept: ['text/plain'] });
    expect(page.text).toMatch(/^live-factcheck\//);
  });

  it('keeps caller headers on same-origin redirects and drops them for other origins', async () => {
    const headers = { 'x-api-key': 'secret-key' };
    const same = await fetcher().fetchText(at('/redirect-same-origin'), {
      accept: ['text/plain'],
      headers,
    });
    expect(same.text).toBe('secret-key');
    const other = await fetcher().fetchText(at('/redirect-other-origin'), {
      accept: ['text/plain'],
      headers,
    });
    expect(other.url).toBe(`http://other.test:${String(port)}/echo-key`);
    expect(other.text).toBe('none');
  });

  it('refuses a body limit above 5 MB (bounded synchronous parsing)', () => {
    expect(() =>
      createSafeFetcher({ userAgent: 'x', timeoutMs: 1_000, maxBytes: 50_000_000 }),
    ).toThrow('maxBytes must not exceed');
  });

  it('follows a safe relative redirect', async () => {
    const page = await fetcher().fetchText(at('/redirect-ok'), { accept: html });
    expect(page.url).toBe(at('/page'));
  });

  describe('refuses', () => {
    it('a host that resolves to the metadata address', async () => {
      await expect(
        fetcher().fetchText(at('/page', 'metadata.attacker.test'), { accept: html }),
      ).rejects.toBeInstanceOf(FetchBlockedError);
    });

    it('a host where any one of several addresses is internal (DNS rebinding)', async () => {
      await expect(
        fetcher().fetchText(at('/page', 'mixed.attacker.test'), { accept: html }),
      ).rejects.toBeInstanceOf(FetchBlockedError);
    });

    it('a host without addresses', async () => {
      await expect(
        fetcher().fetchText(at('/page', 'nothing.test'), { accept: html }),
      ).rejects.toBeInstanceOf(FetchBlockedError);
    });

    it('a redirect to the metadata IP, without connecting to it', async () => {
      await expect(fetcher().fetchText(at('/redirect-internal'), { accept: html })).rejects.toThrow(
        /redirect.*address not allowed/,
      );
    });

    it('a redirect to an internal service name', async () => {
      await expect(fetcher().fetchText(at('/redirect-hostname'), { accept: html })).rejects.toThrow(
        /redirect.*(internal host name|port)/,
      );
    });

    it('more than three redirects', async () => {
      await expect(fetcher().fetchText(at('/loop'), { accept: html })).rejects.toThrow(
        'too many redirects',
      );
    });

    it('a body larger than the limit (with and without content-length)', async () => {
      await expect(
        fetcher({ maxBytes: 1_000 }).fetchText(at('/big'), { accept: html }),
      ).rejects.toThrow('response too large');
      await expect(
        fetcher({ maxBytes: 1_000 }).fetchText(at('/big-chunked'), { accept: html }),
      ).rejects.toThrow('response too large');
    });

    it('a content type that is not accepted', async () => {
      await expect(fetcher().fetchText(at('/pdf'), { accept: html })).rejects.toThrow(
        'content type',
      );
    });

    it('a response slower than the timeout', async () => {
      await expect(
        fetcher({ timeoutMs: 200 }).fetchText(at('/slow'), { accept: html }),
      ).rejects.toBeInstanceOf(FetchFailedError);
    });

    it('URLs rejected by the static checks, before any connection', async () => {
      const before = hits.length;
      for (const url of [
        'http://10.0.0.1/',
        'file:///etc/passwd',
        `http://localhost:${String(port)}/page`,
      ]) {
        await expect(fetcher().fetchText(url, { accept: html })).rejects.toBeInstanceOf(
          FetchBlockedError,
        );
      }
      expect(hits.length).toBe(before);
    });
  });

  it('the production policy blocks the loopback fake server outright', async () => {
    const production = createSafeFetcher({
      userAgent: 'x',
      timeoutMs: 500,
      maxBytes: 1_000,
      resolve,
    });
    await expect(
      production.fetchText(`http://site.test/page`, { accept: html }),
    ).rejects.toBeInstanceOf(FetchBlockedError);
  });
});
