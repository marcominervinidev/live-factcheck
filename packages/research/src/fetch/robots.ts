import type { TextCache } from '../cache.js';
import { sha256 } from '../cache.js';
import type { RobotsGroups } from './robots-rules.js';
import { parseRobots, robotsAllowsParsed } from './robots-rules.js';
import type { SafeFetcher } from './safe-fetch.js';
import { FetchBlockedError, FetchFailedError } from './safe-fetch.js';

export interface RobotsPolicy {
  /** Whether our User-Agent may fetch `url` (brief 9.6: robots.txt is respected). */
  isAllowed(url: string, options?: { readonly signal?: AbortSignal }): Promise<boolean>;
}

const DISALLOW_ALL = 'User-agent: *\nDisallow: /\n';
const ALLOW_ALL = '';
const MAX_ROBOTS_CHARS = 500_000;
// Parsed rules per origin, so a large robots.txt is not re-parsed for every URL.
const MAX_PARSED_ORIGINS = 200;

/**
 * robots.txt per origin, fetched through the same SSRF-safe fetch and cached (RFC 9309):
 * 4xx means no rules (allow), 5xx or an unreachable server means "assume complete disallow".
 */
/** How long an unreachable robots.txt (5xx, network error) counts as "disallow all". */
const TRANSIENT_FAILURE_TTL_S = 300;

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
    let ttlSeconds = options.ttlSeconds;
    try {
      const page = await options.fetcher.fetchText(`${origin}/robots.txt`, {
        accept: ['text/plain', 'text/html', 'application/octet-stream'],
        ...(signal === undefined ? {} : { signal }),
      });
      rules = page.text.slice(0, MAX_ROBOTS_CHARS);
    } catch (error) {
      // Our own abort (tier or check timeout) says nothing about the site: disallow for this
      // call only, never cached (review, phase 1: one slow robots.txt blocked a domain for 24 h).
      if (signal?.aborted === true) return DISALLOW_ALL;
      if (error instanceof FetchFailedError && error.status !== undefined && error.status < 500) {
        rules = ALLOW_ALL;
      } else if (error instanceof FetchBlockedError || error instanceof FetchFailedError) {
        rules = DISALLOW_ALL;
        // Unreachable or 5xx is usually temporary: retry after a few minutes, not a day.
        if (!(error instanceof FetchBlockedError)) {
          ttlSeconds = Math.min(ttlSeconds, TRANSIENT_FAILURE_TTL_S);
        }
      } else {
        throw error;
      }
    }
    await options.cache.set(key, rules, ttlSeconds);
    return rules;
  };

  const parsed = new Map<string, { readonly text: string; readonly groups: RobotsGroups }>();
  const groupsFor = async (origin: string, signal?: AbortSignal): Promise<RobotsGroups> => {
    const text = await load(origin, signal);
    const known = parsed.get(origin);
    if (known?.text === text) return known.groups;
    const groups = parseRobots(text);
    if (parsed.size >= MAX_PARSED_ORIGINS) {
      const oldest = parsed.keys().next().value;
      if (oldest !== undefined) parsed.delete(oldest);
    }
    parsed.set(origin, { text, groups });
    return groups;
  };

  return {
    async isAllowed(url, callOptions) {
      const origin = new URL(url).origin;
      return robotsAllowsParsed(
        await groupsFor(origin, callOptions?.signal),
        url,
        options.productToken,
      );
    },
  };
}
