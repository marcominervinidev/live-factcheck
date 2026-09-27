import { z } from 'zod';

/** Web search adapters (brief 9.1): SearXNG is the keyless local default; Brave/Tavily are optional later. */
export const SEARCH_PROVIDERS = ['searxng', 'mock'] as const;
export type SearchProviderName = (typeof SEARCH_PROVIDERS)[number];

export const searchConfigShape = {
  SEARCH_PROVIDER: z.enum(SEARCH_PROVIDERS),
  /** Internal service URL, e.g. `http://searxng:8080`. Trusted configuration, not a user URL. */
  SEARXNG_URL: z.url({ protocol: /^https?$/ }).optional(),
  SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
};

type SearchConfig = z.infer<z.ZodObject<typeof searchConfigShape>>;

export function checkSearchConfig(config: SearchConfig, ctx: z.RefinementCtx): void {
  if (config.SEARCH_PROVIDER === 'searxng' && config.SEARXNG_URL === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['SEARXNG_URL'],
      message: 'required when SEARCH_PROVIDER=searxng',
    });
  }
}

export interface SearchResult {
  /** Absolute http(s) URL chosen by strangers: fetch it only through the SSRF-safe fetch. */
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
}

export interface SearchProvider {
  readonly name: SearchProviderName;
  search(
    query: string,
    options: { readonly language: string; readonly limit: number; readonly signal?: AbortSignal },
  ): Promise<SearchResult[]>;
}

export class SearchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SearchError';
  }
}

const SearxngResponse = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().optional(),
      content: z.string().optional(),
    }),
  ),
});

const isHttpUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

function createSearxng(baseUrl: string, timeoutMs: number): SearchProvider {
  return {
    name: 'searxng',
    async search(query, options) {
      const url = new URL('/search', baseUrl);
      url.search = new URLSearchParams({
        q: query,
        format: 'json',
        language: options.language,
      }).toString();
      const signals = [AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])];
      let body: unknown;
      try {
        const response = await fetch(url, {
          signal: AbortSignal.any(signals),
          headers: { accept: 'application/json' },
        });
        if (!response.ok) {
          throw new SearchError(`searxng answered ${String(response.status)}`);
        }
        body = await response.json();
      } catch (error) {
        if (error instanceof SearchError) throw error;
        throw new SearchError('searxng request failed', { cause: error });
      }
      const parsed = SearxngResponse.safeParse(body);
      if (!parsed.success) {
        throw new SearchError('searxng response has an unexpected shape');
      }
      const seen = new Set<string>();
      const results: SearchResult[] = [];
      for (const item of parsed.data.results) {
        if (!isHttpUrl(item.url) || seen.has(item.url)) continue;
        seen.add(item.url);
        results.push({ url: item.url, title: item.title ?? item.url, snippet: item.content ?? '' });
        if (results.length >= options.limit) break;
      }
      return results;
    },
  };
}

export type MockSearchHandler = (query: string) => SearchResult[];

export function createSearchProvider(
  config: SearchConfig,
  options: { readonly mock?: MockSearchHandler } = {},
): SearchProvider {
  if (config.SEARCH_PROVIDER === 'mock') {
    const handler = options.mock;
    if (handler === undefined) {
      throw new Error('SEARCH_PROVIDER=mock needs mock results from the service');
    }
    return {
      name: 'mock',
      search: (query, searchOptions) =>
        Promise.resolve(handler(query).slice(0, searchOptions.limit)),
    };
  }
  if (config.SEARXNG_URL === undefined) {
    throw new Error('SEARXNG_URL is required for searxng');
  }
  return createSearxng(config.SEARXNG_URL, config.SEARCH_TIMEOUT_MS);
}
