import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { FakeServer } from '../testing/fake-server.js';
import { startFakeServer } from '../testing/fake-server.js';
import {
  SearchError,
  checkSearchConfig,
  createSearchProvider,
  searchConfigShape,
} from './search.js';

const schema = z.object(searchConfigShape).superRefine(checkSearchConfig);

describe('searxng search', () => {
  let server: FakeServer;
  beforeEach(async () => {
    server = await startFakeServer();
  });
  afterEach(async () => {
    await server.close();
  });
  const searxng = () =>
    createSearchProvider(schema.parse({ SEARCH_PROVIDER: 'searxng', SEARXNG_URL: server.url }));

  it('queries the JSON API in German and keeps only unique http(s) results up to the limit', async () => {
    server.respond({
      body: {
        results: [
          {
            url: 'https://de.wikipedia.org/wiki/Zweiter_Weltkrieg',
            title: 'Zweiter Weltkrieg',
            content: '1939–1945',
          },
          { url: 'javascript:alert(1)', title: 'bad' },
          { url: 'https://de.wikipedia.org/wiki/Zweiter_Weltkrieg', title: 'duplicate' },
          { url: 'http://example.org/a', content: 'no title' },
          { url: 'https://example.org/b', title: 'over the limit' },
        ],
      },
    });
    const results = await searxng().search('Zweiter Weltkrieg Ende', { language: 'de', limit: 2 });

    expect(results).toEqual([
      {
        url: 'https://de.wikipedia.org/wiki/Zweiter_Weltkrieg',
        title: 'Zweiter Weltkrieg',
        snippet: '1939–1945',
      },
      { url: 'http://example.org/a', title: 'http://example.org/a', snippet: 'no title' },
    ]);
    const path = new URL(server.requests[0]?.path ?? '', server.url);
    expect(path.pathname).toBe('/search');
    expect(Object.fromEntries(path.searchParams)).toEqual({
      q: 'Zweiter Weltkrieg Ende',
      format: 'json',
      language: 'de',
    });
  });

  it('reports HTTP errors and unexpected bodies as SearchError', async () => {
    server.respond({ status: 503, body: {} }, { body: { answers: [] } });
    await expect(searxng().search('x', { language: 'de', limit: 3 })).rejects.toBeInstanceOf(
      SearchError,
    );
    await expect(searxng().search('x', { language: 'de', limit: 3 })).rejects.toThrow(
      'unexpected shape',
    );
  });

  it('requires SEARXNG_URL for searxng and mock results for mock', () => {
    expect(schema.safeParse({ SEARCH_PROVIDER: 'searxng' }).success).toBe(false);
    expect(() => createSearchProvider(schema.parse({ SEARCH_PROVIDER: 'mock' }))).toThrow(
      'needs mock results',
    );
  });
});
