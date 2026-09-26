import type { TextCache } from '../cache.js';
import { sha256 } from '../cache.js';
import { robotsAllows } from './robots-rules.js';
import type { SafeFetcher } from './safe-fetch.js';
import { FetchBlockedError, FetchFailedError } from './safe-fetch.js';

export interface RobotsPolicy {
  /** Whether our User-Agent may fetch `url` (brief 9.6: robots.txt is respected). */
  isAllowed(url: string, options?: { readonly signal?: AbortSignal }): Promise<boolean>;
}

const DISALLOW_ALL = 'User-agent: *\nDisallow: /\n';
const ALLOW_ALL = '';
const MAX_ROBOTS_CHARS = 500_000;

/**
 * robots.txt per origin, fetched through the same SSRF-safe fetch and cached (RFC 9309):
 * 4xx means no rules (allow), 5xx or an unreachable server means "assume complete disallow".
 */
export function createRobotsPolicy(options: {
  readonly fetcher: SafeFetcher;
  readonly cache: TextCache;
  /** The product token matched against robots.txt groups, e.g. `live-factcheck`. */
  readonly productToken: string;
  readonly ttlSeconds: number;
}): RobotsPolicy {
  const load = async (origin: string, signal?: AbortSignal): Promise<string> => {
    const key = `robots:v1:${sha256(origin)}`;
    const cached = await options.cache.get(key);
    if (cached !== null) return cached;
    let rules: string;
    try {
      const page = await options.fetcher.fetchText(`${origin}/robots.txt`, {
        accept: ['text/plain', 'text/html', 'application/octet-stream'],
        ...(signal === undefined ? {} : { signal }),
      });
      rules = page.text.slice(0, MAX_ROBOTS_CHARS);
    } catch (error) {
      if (error instanceof FetchFailedError && error.status !== undefined && error.status < 500) {
        rules = ALLOW_ALL;
      } else if (error instanceof FetchBlockedError || error instanceof FetchFailedError) {
        rules = DISALLOW_ALL;
      } else {
        throw error;
      }
    }
    await options.cache.set(key, rules, options.ttlSeconds);
    return rules;
  };

  return {
    async isAllowed(url, callOptions) {
      const origin = new URL(url).origin;
      return robotsAllows(await load(origin, callOptions?.signal), url, options.productToken);
    },
  };
}
