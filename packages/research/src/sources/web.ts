import type { SearchProvider } from '@lfc/providers';

import { extractDocument } from '../extract.js';
import type { ExtractedDocument } from '../extract.js';
import type { RobotsPolicy } from '../fetch/robots.js';
import type { SafeFetcher } from '../fetch/safe-fetch.js';
import type { TierResolver } from '../tiers.js';
import type { CallOptions, SourceDocument } from './types.js';

/**
 * Web search, tier 3 (brief 9.1): search results → robots.txt → SSRF-safe fetch → extraction.
 * Pages that fail (blocked, disallowed, too large, not HTML) are skipped, not fatal.
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
    ): Promise<SourceDocument[]> {
      const signal = callOptions.signal === undefined ? {} : { signal: callOptions.signal };
      const resultLists = await Promise.allSettled(
        queries.map((query) =>
          options.search.search(query, {
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
      const pages = await Promise.allSettled(
        urls.slice(0, callOptions.maxPages).map(async (url) => {
          if (!(await options.robots.isAllowed(url, signal))) return undefined;
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
          if (extracted === undefined) return undefined;
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
      return pages.flatMap((result) =>
        result.status === 'fulfilled' && result.value !== undefined ? [result.value] : [],
      );
    },
  };
}
