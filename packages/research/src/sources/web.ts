import type { SearchProvider } from '@lfc/providers';

import { extractDocument } from '../extract.js';
import type { ExtractedDocument } from '../extract.js';
import type { RobotsPolicy } from '../fetch/robots.js';
import { FetchBlockedError, FetchFailedError } from '../fetch/safe-fetch.js';
import type { SafeFetcher } from '../fetch/safe-fetch.js';
import type { TierResolver } from '../tiers.js';
import type { CallOptions, SourceDocument } from './types.js';

/** What one web search did, for the research summary log (plan D1): counts only, no URLs. */
export interface WebSearchStats {
  readonly queries: number;
  readonly failedQueries: number;
  /** Unique result URLs over all queries. */
  readonly results: number;
  /** Results the tier tried to load (at most `maxPages`). */
  readonly pages: number;
  /** Pages without a document, by reason (`robots`, `blocked`, `http_403`, `unreadable`, …). */
  readonly skipped: Readonly<Record<string, number>>;
}

export interface WebSearchResult {
  readonly documents: SourceDocument[];
  readonly stats: WebSearchStats;
}

/** A short label for why a page gave no document; never the URL or the error text. */
function skipReason(error: unknown): string {
  if (error instanceof FetchBlockedError) return 'blocked';
  if (error instanceof FetchFailedError) {
    if (error.status !== undefined) return `http_${String(error.status)}`;
    if (error.message.startsWith('content type')) return 'content_type';
    if (error.message === 'response too large') return 'too_large';
    return 'fetch_failed';
  }
  return error instanceof Error ? error.name : 'unknown';
}

/**
 * Web search, tier 3 (brief 9.1): search results → robots.txt → SSRF-safe fetch → extraction.
 * Pages that fail (blocked, disallowed, too large, not HTML) are skipped, not fatal; the stats
 * count why.
 */
export function createWebSource(options: {
  readonly search: SearchProvider;
  readonly fetcher: SafeFetcher;
  readonly robots: RobotsPolicy;
  readonly tiers: TierResolver;
  readonly maxChars: number;
  readonly now: () => Date;
}) {
  return {
    async search(
      queries: readonly string[],
      callOptions: CallOptions & { readonly resultsPerQuery: number; readonly maxPages: number },
    ): Promise<WebSearchResult> {
      const signal = callOptions.signal === undefined ? {} : { signal: callOptions.signal };
      const resultLists = await Promise.allSettled(
        queries.map((query) =>
          options.search.search(query, {
            // LANG-EN: search results in German only; pass the conversation language (ADR 0020)
            language: 'de',
            limit: callOptions.resultsPerQuery,
            ...signal,
          }),
        ),
      );
      const urls: string[] = [];
      for (const list of resultLists) {
        if (list.status !== 'fulfilled') continue;
        for (const result of list.value) {
          if (!urls.includes(result.url)) urls.push(result.url);
        }
      }
      const skipped: Record<string, number> = {};
      const skip = (reason: string) => {
        skipped[reason] = (skipped[reason] ?? 0) + 1;
      };
      const attempted = urls.slice(0, callOptions.maxPages);
      const pages = await Promise.allSettled(
        attempted.map(async (url) => {
          if (!(await options.robots.isAllowed(url, signal))) {
            skip('robots');
            return undefined;
          }
          const page = await options.fetcher.fetchText(url, {
            accept: ['text/html', 'text/plain'],
            ...signal,
          });
          const extracted: ExtractedDocument | undefined =
            page.contentType === 'text/plain'
              ? {
                  title: page.url,
                  text: page.text.slice(0, options.maxChars),
                  publisher: new URL(page.url).hostname,
                }
              : extractDocument(page.text, page.url, options.maxChars);
          if (extracted === undefined) {
            skip('unreadable');
            return undefined;
          }
          return {
            url: page.url,
            title: extracted.title,
            publisher: extracted.publisher,
            ...(extracted.publishedAt === undefined ? {} : { publishedAt: extracted.publishedAt }),
            retrievedAt: options.now().toISOString(),
            ...options.tiers(page.url),
            text: extracted.text,
          } satisfies SourceDocument;
        }),
      );
      for (const result of pages) if (result.status === 'rejected') skip(skipReason(result.reason));
      return {
        documents: pages.flatMap((result) =>
          result.status === 'fulfilled' && result.value !== undefined ? [result.value] : [],
        ),
        stats: {
          queries: queries.length,
          failedQueries: resultLists.filter((list) => list.status === 'rejected').length,
          results: urls.length,
          pages: attempted.length,
          skipped,
        },
      };
    },
  };
}
