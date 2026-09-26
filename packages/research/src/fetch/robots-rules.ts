/**
 * Minimal robots.txt matcher after RFC 9309: groups by user-agent (most specific product token
 * wins, `*` as fallback), `Allow`/`Disallow` with `*` wildcards and `$` end anchors, longest
 * matching rule wins, `Allow` wins a tie. Written in-house because the common npm parser ships
 * broken typings (`declare module` makes it `any`).
 */
interface Rule {
  readonly allow: boolean;
  readonly pattern: RegExp;
  readonly length: number;
}

function toRegExp(path: string): RegExp {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

function parseGroups(robotsTxt: string): Map<string, Rule[]> {
  const groups = new Map<string, Rule[]>();
  let agents: string[] = [];
  let inRules = false;
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
      if (value === '') continue; // "Disallow:" with no path allows everything
      for (const agent of agents) {
        groups
          .get(agent)
          ?.push({ allow: field === 'allow', pattern: toRegExp(value), length: value.length });
      }
    }
  }
  return groups;
}

/** Whether `productToken` (e.g. `live-factcheck`) may fetch `url` under these rules. */
export function robotsAllows(robotsTxt: string, url: string, productToken: string): boolean {
  const groups = parseGroups(robotsTxt);
  const token = productToken.toLowerCase();
  const rules = groups.get(token) ?? groups.get('*') ?? [];
  const target = new URL(url);
  let pathname = target.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Malformed percent-encoding: match the raw path.
  }
  const path = pathname + target.search;
  let best: Rule | undefined;
  for (const rule of rules) {
    if (!rule.pattern.test(path)) continue;
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
