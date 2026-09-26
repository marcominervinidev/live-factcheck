/**
 * Minimal robots.txt matcher after RFC 9309: groups by user-agent (the group of our product
 * token wins, `*` as fallback), `Allow`/`Disallow` with `*` wildcards and `$` end anchors,
 * longest matching rule wins, `Allow` wins a tie. Written in-house because the common npm
 * parser ships broken typings (`declare module` makes it `any`).
 *
 * Matching is linear (no RegExp): robots.txt is written by strangers, and a backtracking
 * pattern like `/*a*a*a*a*b$` would block the event loop (security review finding 1).
 */
interface Rule {
  readonly allow: boolean;
  /** The pattern split at `*`. */
  readonly segments: readonly string[];
  readonly anchored: boolean;
  readonly length: number;
}

export type RobotsGroups = ReadonlyMap<string, readonly Rule[]>;

// Bounds for text written by strangers.
const MAX_RULE_LENGTH = 512;
const MAX_RULES = 2_000;
const MAX_PATH_LENGTH = 2_048;

function toRule(allow: boolean, path: string): Rule {
  const anchored = path.endsWith('$');
  const body = anchored ? path.slice(0, -1) : path;
  return { allow, segments: body.split('*'), anchored, length: path.length };
}

/**
 * Glob match with `*` only, greedy leftmost: O(path × pattern) via indexOf, never exponential.
 * Correct for `*`-only globs because taking the leftmost occurrence of each literal segment
 * never prevents a later segment from matching.
 */
function matches(rule: Rule, path: string): boolean {
  const { segments, anchored } = rule;
  const first = segments[0] ?? '';
  if (!path.startsWith(first)) return false;
  if (segments.length === 1) return !anchored || path.length === first.length;
  let position = first.length;
  const lastIndex = segments.length - 1;
  for (let i = 1; i < lastIndex; i++) {
    const segment = segments[i] ?? '';
    const found = path.indexOf(segment, position);
    if (found < 0) return false;
    position = found + segment.length;
  }
  const last = segments[lastIndex] ?? '';
  if (anchored) {
    return path.length - last.length >= position && path.endsWith(last);
  }
  return path.includes(last, position);
}

export function parseRobots(robotsTxt: string): RobotsGroups {
  const groups = new Map<string, Rule[]>();
  let agents: string[] = [];
  let inRules = false;
  let ruleCount = 0;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      if (inRules) {
        agents = [];
        inRules = false;
      }
      const agent = value.toLowerCase();
      agents.push(agent);
      if (!groups.has(agent)) groups.set(agent, []);
    } else if (field === 'allow' || field === 'disallow') {
      inRules = true;
      // "Disallow:" with no path allows everything; overlong rules are ignored.
      if (value === '' || value.length > MAX_RULE_LENGTH || ruleCount >= MAX_RULES) continue;
      ruleCount++;
      const rule = toRule(field === 'allow', value);
      for (const agent of agents) {
        groups.get(agent)?.push(rule);
      }
    }
  }
  return groups;
}

/** Whether `productToken` (e.g. `live-factcheck`) may fetch `url` under these rules. */
export function robotsAllowsParsed(
  groups: RobotsGroups,
  url: string,
  productToken: string,
): boolean {
  const rules = groups.get(productToken.toLowerCase()) ?? groups.get('*') ?? [];
  const target = new URL(url);
  let pathname = target.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Malformed percent-encoding: match the raw path.
  }
  const path = (pathname + target.search).slice(0, MAX_PATH_LENGTH);
  let best: Rule | undefined;
  for (const rule of rules) {
    if (!matches(rule, path)) continue;
    if (
      best === undefined ||
      rule.length > best.length ||
      (rule.length === best.length && rule.allow)
    ) {
      best = rule;
    }
  }
  return best?.allow ?? true;
}

/** Parse and match in one step (tests and one-off checks). */
export function robotsAllows(robotsTxt: string, url: string, productToken: string): boolean {
  return robotsAllowsParsed(parseRobots(robotsTxt), url, productToken);
}
