import { readFileSync } from 'node:fs';

import type { SearchProvider } from '@lfc/providers';
import { createEmbeddingProvider } from '@lfc/providers';
import { describe, expect, it } from 'vitest';

import type { TextCache } from './cache.js';
import type { RobotsPolicy } from './fetch/robots.js';
import type { FetchTextOptions, SafeFetcher } from './fetch/safe-fetch.js';
import { FetchBlockedError } from './fetch/safe-fetch.js';
import { rankChunks } from './rank.js';
import { cachedFetcher, cachedSearch, researchClaim } from './research.js';
import { parseSourceTiers } from './source-tiers.js';
import { createFactCheckSource } from './sources/factcheck.js';
import { createWebSource } from './sources/web.js';
import { createWikidataSource, createWikipediaSource, formatWikidataTime } from './sources/wiki.js';
import { createTierResolver } from './tiers.js';

const tiers = createTierResolver(
  parseSourceTiers(
    readFileSync(new URL('../../../config/source-tiers.yaml', import.meta.url), 'utf8'),
  ),
);
const now = () => new Date('2026-09-26T10:00:00.000Z');

type Answer = { contentType: string; text: string } | Error;

/** The HTTP boundary: answers per URL prefix; records every request with its headers. */
function fakeFetcher(routes: Record<string, Answer | ((url: string) => Answer)>) {
  const calls: { url: string; options: FetchTextOptions }[] = [];
  const fetcher: SafeFetcher = {
    fetchText(url, options) {
      calls.push({ url, options });
      const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1];
      const answer = typeof route === 'function' ? route(url) : route;
      if (answer === undefined) return Promise.reject(new Error(`no route for ${url}`));
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({
        url,
        status: 200,
        contentType: answer.contentType,
        text: answer.text,
      });
    },
  };
  return { fetcher, calls };
}

const json = (value: unknown) => ({ contentType: 'application/json', text: JSON.stringify(value) });
const html = (body: string) => ({
  contentType: 'text/html',
  text: `<html><head><title>T</title></head><body><article><p>${body}</p></article></body></html>`,
});

describe('tier resolver', () => {
  it.each([
    ['https://correctiv.org/faktencheck/x', 'faktencheck', 1],
    ['https://www.destatis.de/DE/Themen', 'amtlich', 0.9],
    ['https://www.statistik.bund.de/x', 'amtlich', 0.9],
    ['https://de.wikipedia.org/wiki/X', 'referenz', 0.8],
    ['https://www.tagesschau.de/faktenfinder/x', 'presse', 0.6],
    ['https://blog.example.org/', 'sonstige', 0.3],
    ['https://notbund.de/', 'sonstige', 0.3],
  ])('%s → %s', (url, tier, weight) => {
    expect(tiers(url)).toEqual({ tier, weight });
  });
});

describe('Google Fact Check source (tier 1)', () => {
  it('sends the key as header, never in the URL, and maps ClaimReview entries', async () => {
    const { fetcher, calls } = fakeFetcher({
      'https://factchecktools.googleapis.com/': json({
        claims: [
          {
            text: 'Der Zweite Weltkrieg endete 1965',
            claimReview: [
              {
                publisher: { name: 'CORRECTIV', site: 'correctiv.org' },
                url: 'https://correctiv.org/faktencheck/ww2',
                textualRating: 'Falsch',
                reviewDate: '2025-05-08T00:00:00Z',
              },
              {
                publisher: { name: ' ', site: 'x.org' },
                url: 'javascript:alert(1)',
                textualRating: 'Falsch',
              },
              { url: 'https://example.org/no-rating', textualRating: '  ' },
            ],
          },
        ],
      }),
    });
    const hits = await createFactCheckSource({
      fetcher,
      apiKey: 'goog-secret',
      languageCode: 'de',
    }).search('Der Krieg endete 1965', { limit: 5 });

    expect(hits).toEqual([
      {
        claimText: 'Der Zweite Weltkrieg endete 1965',
        publisher: 'CORRECTIV',
        url: 'https://correctiv.org/faktencheck/ww2',
        rating: 'Falsch',
        reviewDate: '2025-05-08T00:00:00Z',
      },
    ]);
    const [call] = calls;
    expect(call?.url).not.toContain('goog-secret');
    expect(call?.options.headers?.['x-goog-api-key']).toBe('goog-secret');
    expect(new URL(call?.url ?? '').searchParams.get('languageCode')).toBe('de');
  });
});

describe('Wikipedia and Wikidata sources (tier 2)', () => {
  it('searches German Wikipedia and extracts the page text', async () => {
    const { fetcher } = fakeFetcher({
      'https://de.wikipedia.org/w/rest.php/v1/search/page': json({
        pages: [{ key: 'Zweiter_Weltkrieg', title: 'Zweiter Weltkrieg' }],
      }),
      'https://de.wikipedia.org/w/rest.php/v1/page/Zweiter_Weltkrieg/html': html(
        'Der Zweite Weltkrieg dauerte von 1939 bis 1945.',
      ),
    });
    const docs = await createWikipediaSource({ fetcher, tiers, maxChars: 10_000, now }).search(
      'Zweiter Weltkrieg',
      {
        limit: 1,
      },
    );
    expect(docs).toEqual([
      {
        url: 'https://de.wikipedia.org/wiki/Zweiter_Weltkrieg',
        title: 'Zweiter Weltkrieg',
        publisher: 'Wikipedia',
        retrievedAt: '2026-09-26T10:00:00.000Z',
        tier: 'referenz',
        weight: 0.8,
        text: 'Der Zweite Weltkrieg dauerte von 1939 bis 1945.',
      },
    ]);
  });

  it('renders Wikidata dates and counts as German evidence text', async () => {
    const time = (t: string, precision = 11) => ({
      mainsnak: { datavalue: { type: 'time', value: { time: t, precision } } },
    });
    const { fetcher } = fakeFetcher({
      'https://www.wikidata.org/w/api.php?action=wbsearchentities': json({
        search: [{ id: 'Q362' }],
      }),
      'https://www.wikidata.org/w/api.php?action=wbgetentities': json({
        entities: {
          Q362: {
            labels: { de: { value: 'Zweiter Weltkrieg' } },
            descriptions: { de: { value: 'globaler Krieg' } },
            claims: {
              P580: [time('+1939-09-01T00:00:00Z')],
              P582: [time('+1945-09-02T00:00:00Z')],
              P1082: [
                { mainsnak: { datavalue: { type: 'quantity', value: { amount: '+3850809' } } } },
              ],
              P999: [time('+2000-01-01T00:00:00Z')],
            },
          },
        },
      }),
    });
    const [doc] = await createWikidataSource({ fetcher, tiers, now }).search('Zweiter Weltkrieg', {
      limit: 1,
    });
    expect(doc?.url).toBe('https://www.wikidata.org/wiki/Q362');
    expect(doc?.text).toBe(
      'Zweiter Weltkrieg: globaler Krieg. Beginn: 1. September 1939. Ende: 2. September 1945. Einwohnerzahl: 3.850.809.',
    );
  });

  it.each([
    ['+1945-09-02T00:00:00Z', 11, '2. September 1945'],
    ['+1945-05-00T00:00:00Z', 10, 'Mai 1945'],
    ['+1945-00-00T00:00:00Z', 9, '1945'],
    ['-0044-03-15T00:00:00Z', 11, '15. März 44 v. Chr.'],
    ['+1900-00-00T00:00:00Z', 7, undefined],
  ])('formats Wikidata time %s (precision %i)', (value, precision, expected) => {
    expect(formatWikidataTime(value, precision)).toBe(expected);
  });
});

describe('web source (tier 3)', () => {
  const search: SearchProvider = {
    name: 'mock',
    search: (query) =>
      Promise.resolve([
        { url: 'https://www.destatis.de/a', title: 'A', snippet: '' },
        { url: 'https://blocked.example.org/', title: 'B', snippet: '' },
        { url: 'https://robots-says-no.example.org/', title: 'C', snippet: '' },
        { url: `https://www.destatis.de/a`, title: `duplicate for ${query}`, snippet: '' },
      ]),
  };
  const robots: RobotsPolicy = {
    isAllowed: (url) => Promise.resolve(!url.includes('robots-says-no')),
  };

  it('fetches allowed, unique results and skips blocked or disallowed pages', async () => {
    const { fetcher, calls } = fakeFetcher({
      'https://www.destatis.de/a': html('Berlin hatte Ende 2024 rund 3,9 Millionen Einwohner.'),
      'https://blocked.example.org/': new FetchBlockedError('address not allowed'),
    });
    const docs = await createWebSource({
      search,
      fetcher,
      robots,
      tiers,
      maxChars: 10_000,
      now,
    }).search(['q1', 'q2'], {
      resultsPerQuery: 5,
      maxPages: 5,
    });
    expect(docs.map((d) => [d.url, d.tier])).toEqual([['https://www.destatis.de/a', 'amtlich']]);
    expect(calls.map((c) => c.url)).not.toContain('https://robots-says-no.example.org/');
  });
});

describe('researchClaim', () => {
  it('runs all tiers in parallel and survives a failing tier', async () => {
    const { fetcher } = fakeFetcher({
      'https://de.wikipedia.org/w/rest.php/v1/search/page': new Error('wikipedia down'),
      'https://www.wikidata.org/': json({ search: [] }),
      'https://www.destatis.de/a': html('Berlin hatte Ende 2024 rund 3,9 Millionen Einwohner.'),
    });
    const search: SearchProvider = {
      name: 'mock',
      search: () =>
        Promise.resolve([{ url: 'https://www.destatis.de/a', title: 'A', snippet: '' }]),
    };
    const robots: RobotsPolicy = { isAllowed: () => Promise.resolve(true) };
    const result = await researchClaim(
      { claim: 'Berlin hat 3,9 Millionen Einwohner.', queries: ['Berlin Einwohner 2024'] },
      {
        wikipedia: createWikipediaSource({ fetcher, tiers, maxChars: 10_000, now }),
        wikidata: createWikidataSource({ fetcher, tiers, now }),
        web: createWebSource({ search, fetcher, robots, tiers, maxChars: 10_000, now }),
      },
      {
        timeoutMs: 1_000,
        factChecks: 3,
        wikipediaPages: 2,
        wikidataEntities: 2,
        resultsPerQuery: 5,
        webPages: 5,
      },
    );
    expect(result.documents.map((d) => d.url)).toEqual(['https://www.destatis.de/a']);
    expect(result.factChecks).toEqual([]);
    expect(result.failures).toEqual([{ source: 'wikipedia', reason: 'Error: wikipedia down' }]);
  });

  it('drops a tier that exceeds its timeout', async () => {
    const never: SafeFetcher = {
      fetchText: (_url, options) =>
        new Promise((_, reject) =>
          options.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          }),
        ),
    };
    const search: SearchProvider = { name: 'mock', search: () => Promise.resolve([]) };
    const robots: RobotsPolicy = { isAllowed: () => Promise.resolve(true) };
    const result = await researchClaim(
      { claim: 'x', queries: [] },
      {
        wikipedia: createWikipediaSource({ fetcher: never, tiers, maxChars: 100, now }),
        wikidata: createWikidataSource({ fetcher: never, tiers, now }),
        web: createWebSource({ search, fetcher: never, robots, tiers, maxChars: 100, now }),
      },
      {
        timeoutMs: 50,
        factChecks: 1,
        wikipediaPages: 1,
        wikidataEntities: 1,
        resultsPerQuery: 1,
        webPages: 1,
      },
    );
    expect(result.failures.map((f) => f.source)).toEqual(['wikipedia', 'wikidata']);
    expect(result.documents).toEqual([]);
  });
});

function memoryCache(): TextCache & { size(): number } {
  const values = new Map<string, string>();
  return {
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    size: () => values.size,
  };
}

describe('caches (ADR 0008 level 3)', () => {
  it('serve repeated fetches and searches from the cache', async () => {
    const { fetcher, calls } = fakeFetcher({ 'https://example.org/': html('Text.') });
    const cache = memoryCache();
    const cached = cachedFetcher(fetcher, cache, 60);
    await cached.fetchText('https://example.org/', { accept: ['text/html'] });
    const again = await cached.fetchText('https://example.org/', { accept: ['text/html'] });
    expect(again.text).toContain('Text.');
    expect(calls).toHaveLength(1);

    let searches = 0;
    const search = cachedSearch(
      {
        name: 'searxng',
        search: () =>
          Promise.resolve([
            { url: `https://x.org/${String(++searches)}`, title: 't', snippet: '' },
          ]),
      },
      cache,
      60,
    );
    await search.search('q', { language: 'de', limit: 3 });
    expect(await search.search('q', { language: 'de', limit: 3 })).toEqual([
      { url: 'https://x.org/1', title: 't', snippet: '' },
    ]);
    expect(searches).toBe(1);
  });

  it('never caches failures', async () => {
    const { fetcher, calls } = fakeFetcher({ 'https://example.org/': new Error('down') });
    const cached = cachedFetcher(fetcher, memoryCache(), 60);
    await expect(
      cached.fetchText('https://example.org/', { accept: ['text/html'] }),
    ).rejects.toThrow('down');
    await expect(
      cached.fetchText('https://example.org/', { accept: ['text/html'] }),
    ).rejects.toThrow('down');
    expect(calls).toHaveLength(2);
  });
});

describe('rankChunks', () => {
  const embeddings = createEmbeddingProvider({
    EMBEDDINGS_PROVIDER: 'mock',
    EMBEDDINGS_MODEL: 'mock',
    EMBEDDINGS_TIMEOUT_MS: 1_000,
  });
  const doc = (url: string, text: string) => ({
    url,
    title: url,
    publisher: 'p',
    retrievedAt: now().toISOString(),
    ...tiers(url),
    text,
  });

  it("ranks the chunk that shares the claim's words first and weights tiers", async () => {
    const ranked = await rankChunks(
      'Der Zweite Weltkrieg endete 1945',
      [
        doc('https://blog.example.org/', 'Berlin hat viele Einwohner und Parks.'),
        doc('https://de.wikipedia.org/wiki/X', 'Der Zweite Weltkrieg endete 1945 in Europa.'),
      ],
      embeddings,
      { topK: 2, maxChunksPerDocument: 4 },
    );
    expect(ranked[0]?.document.url).toBe('https://de.wikipedia.org/wiki/X');
    expect(ranked[0]?.score).toBeCloseTo((ranked[0]?.similarity ?? 0) * 0.8, 10);
    expect(new Set(ranked.map((r) => r.id)).size).toBe(2);
  });

  it('returns nothing for no documents without calling the embeddings', async () => {
    expect(await rankChunks('x', [], embeddings, { topK: 3, maxChunksPerDocument: 2 })).toEqual([]);
  });
});
