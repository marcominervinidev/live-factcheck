import { describe, expect, it } from 'vitest';

import type { TextCache } from '../cache.js';
import { createRobotsPolicy } from './robots.js';
import { robotsAllows } from './robots-rules.js';
import type { FetchTextOptions, SafeFetcher } from './safe-fetch.js';
import { FetchBlockedError, FetchFailedError } from './safe-fetch.js';

const TOKEN = 'live-factcheck';

describe('robotsAllows (RFC 9309)', () => {
  const rules = `
# comment
User-agent: *
Disallow: /private/
Allow: /private/public-page
Disallow: /*.pdf$

User-agent: live-factcheck
User-agent: other-bot
Disallow: /no-bots/
`;

  it.each([
    ['https://example.org/', true],
    ['https://example.org/no-bots/page', false],
    // Our own group applies, so the * group's rules do not.
    ['https://example.org/private/x', true],
  ])('for our product token: %s → %s', (url, allowed) => {
    expect(robotsAllows(rules, url, TOKEN)).toBe(allowed);
  });

  it.each([
    ['https://example.org/private/x', false],
    ['https://example.org/private/public-page', true],
    ['https://example.org/report.pdf', false],
    ['https://example.org/report.pdf?download=1', true],
    ['https://example.org/no-bots/page', true],
  ])('for another bot (the * group): %s → %s', (url, allowed) => {
    expect(robotsAllows(rules, url, 'somebot')).toBe(allowed);
  });

  it('allows everything for an empty file and for "Disallow:" without a path', () => {
    expect(robotsAllows('', 'https://example.org/x', TOKEN)).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow:\n', 'https://example.org/x', TOKEN)).toBe(true);
  });

  it('lets Allow win a tie of equally long rules', () => {
    expect(
      robotsAllows('User-agent: *\nDisallow: /a\nAllow: /a\n', 'https://example.org/a', TOKEN),
    ).toBe(true);
  });
});

function memoryCache(): TextCache & { keys(): string[] } {
  const values = new Map<string, string>();
  return {
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    keys: () => [...values.keys()],
  };
}

function fetcherAnswering(
  answer: (url: string) => string | Error,
): SafeFetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetchText(url: string, _options: FetchTextOptions) {
      calls.push(url);
      const result = answer(url);
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve({ url, status: 200, contentType: 'text/plain', text: result });
    },
  };
}

describe('robots policy', () => {
  const policy = (fetcher: SafeFetcher, cache = memoryCache()) =>
    createRobotsPolicy({ fetcher, cache, productToken: TOKEN, ttlSeconds: 86_400 });

  it('fetches robots.txt once per origin and caches it', async () => {
    const fetcher = fetcherAnswering(() => 'User-agent: *\nDisallow: /secret\n');
    const robots = policy(fetcher);
    expect(await robots.isAllowed('https://example.org/page')).toBe(true);
    expect(await robots.isAllowed('https://example.org/secret/x')).toBe(false);
    expect(fetcher.calls).toEqual(['https://example.org/robots.txt']);
  });

  it('allows everything when robots.txt is missing (4xx)', async () => {
    const robots = policy(
      fetcherAnswering(() => new FetchFailedError('HTTP 404', { status: 404 })),
    );
    expect(await robots.isAllowed('https://example.org/x')).toBe(true);
  });

  it.each([
    ['a 5xx answer', new FetchFailedError('HTTP 503', { status: 503 })],
    ['a timeout', new FetchFailedError('request failed')],
    ['a blocked target', new FetchBlockedError('address not allowed')],
  ])('disallows everything on %s', async (_label, error) => {
    expect(await policy(fetcherAnswering(() => error)).isAllowed('https://example.org/x')).toBe(
      false,
    );
  });
});
