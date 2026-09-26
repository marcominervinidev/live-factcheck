import type { SearchProvider, SearchResult } from '@lfc/providers';

import type { TextCache } from './cache.js';
import { sha256 } from './cache.js';
import type { FetchedText, SafeFetcher } from './fetch/safe-fetch.js';
import type { FactCheckSource } from './sources/factcheck.js';
import type { FactCheckHit, SourceDocument } from './sources/types.js';
import type { createWebSource } from './sources/web.js';
import type { createWikidataSource, createWikipediaSource } from './sources/wiki.js';

/** Level 3 of ADR 0008: fetched pages and API answers cached by URL (never errors). */
export function cachedFetcher(
  fetcher: SafeFetcher,
  cache: TextCache,
  ttlSeconds: number,
): SafeFetcher {
  return {
    async fetchText(url, options) {
      const key = `page:v1:${sha256(`${url}\n${options.accept.join(',')}`)}`;
      const hit = await cache.get(key);
      if (hit !== null) return JSON.parse(hit) as FetchedText;
      const page = await fetcher.fetchText(url, options);
      await cache.set(key, JSON.stringify(page), ttlSeconds);
      return page;
    },
  };
}

/** Level 3 of ADR 0008: search results cached by provider and query. */
export function cachedSearch(
  search: SearchProvider,
  cache: TextCache,
  ttlSeconds: number,
): SearchProvider {
  return {
    name: search.name,
    async search(query, options) {
      const key = `search:v1:${search.name}:${sha256(`${options.language}\n${String(options.limit)}\n${query}`)}`;
      const hit = await cache.get(key);
      if (hit !== null) return JSON.parse(hit) as SearchResult[];
      const results = await search.search(query, options);
      await cache.set(key, JSON.stringify(results), ttlSeconds);
      return results;
    },
  };
}

export interface ResearchSources {
  /** Absent when no Google Fact Check key is configured (the tier is then skipped). */
  readonly factCheck?: FactCheckSource;
  readonly wikipedia: ReturnType<typeof createWikipediaSource>;
  readonly wikidata: ReturnType<typeof createWikidataSource>;
  readonly web: ReturnType<typeof createWebSource>;
}

export interface ResearchLimits {
  /** Per tier; a slow tier is dropped, the others still count (brief 9.6). */
  readonly timeoutMs: number;
  readonly factChecks: number;
  readonly wikipediaPages: number;
  readonly wikidataEntities: number;
  readonly resultsPerQuery: number;
  readonly webPages: number;
}

export interface ResearchResult {
  readonly documents: readonly SourceDocument[];
  readonly factChecks: readonly FactCheckHit[];
  /** Tiers that failed or timed out; for metrics and logs, never shown to users. */
  readonly failures: readonly { readonly source: string; readonly reason: string }[];
}

async function withTimeout<T>(
  source: string,
  timeoutMs: number,
  parent: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
) {
  const signal = AbortSignal.any([
    AbortSignal.timeout(timeoutMs),
    ...(parent === undefined ? [] : [parent]),
  ]);
  try {
    return { source, value: await run(signal) };
  } catch (error) {
    return {
      source,
      reason: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error',
    };
  }
}

/**
 * Live research for one claim (brief 9.1, 9.6 step 3): all tiers in parallel, each with its own
 * timeout; a failing tier never fails the whole research.
 */
export async function researchClaim(
  input: { readonly claim: string; readonly queries: readonly string[] },
  sources: ResearchSources,
  limits: ResearchLimits,
  signal?: AbortSignal,
): Promise<ResearchResult> {
  const reference = input.queries[0] ?? input.claim;
  const factCheck = sources.factCheck;
  const [facts, wikipedia, wikidata, web] = await Promise.all([
    factCheck === undefined
      ? Promise.resolve({ source: 'factcheck', value: [] as FactCheckHit[] })
      : withTimeout('factcheck', limits.timeoutMs, signal, (s) =>
          factCheck.search(input.claim, { limit: limits.factChecks, signal: s }),
        ),
    withTimeout('wikipedia', limits.timeoutMs, signal, (s) =>
      sources.wikipedia.search(reference, { limit: limits.wikipediaPages, signal: s }),
    ),
    withTimeout('wikidata', limits.timeoutMs, signal, (s) =>
      sources.wikidata.search(reference, { limit: limits.wikidataEntities, signal: s }),
    ),
    withTimeout('web', limits.timeoutMs, signal, (s) =>
      sources.web.search(input.queries.length > 0 ? input.queries : [input.claim], {
        resultsPerQuery: limits.resultsPerQuery,
        maxPages: limits.webPages,
        signal: s,
      }),
    ),
  ]);

  const failures = [facts, wikipedia, wikidata, web].flatMap((r) =>
    'reason' in r ? [{ source: r.source, reason: r.reason }] : [],
  );
  const documents: SourceDocument[] = [];
  const seen = new Set<string>();
  for (const result of [wikipedia, wikidata, web]) {
    if (!('value' in result)) continue;
    for (const document of result.value) {
      if (seen.has(document.url)) continue;
      seen.add(document.url);
      documents.push(document);
    }
  }
  return { documents, factChecks: 'value' in facts ? facts.value : [], failures };
}
