import type { SourceTier } from '@lfc/contracts';

import type { SourceTiersFile } from './source-tiers.js';

export type TierResolver = (url: string) => { readonly tier: SourceTier; readonly weight: number };

/**
 * Maps a URL to its tier by registrable-domain suffix (`bund.de` matches `www.destatis.bund.de`);
 * the longest matching domain wins, unlisted domains are `sonstige` (brief 9.1).
 */
export function createTierResolver(file: SourceTiersFile): TierResolver {
  const entries = (
    Object.entries(file.tiers) as [SourceTier, SourceTiersFile['tiers'][SourceTier]][]
  )
    .flatMap(([tier, { weight, domains }]) => domains.map((domain) => ({ tier, weight, domain })))
    .sort((a, b) => b.domain.length - a.domain.length);
  const fallback = { tier: 'sonstige' as const, weight: file.tiers.sonstige.weight };
  return (url) => {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    const match = entries.find(({ domain }) => host === domain || host.endsWith(`.${domain}`));
    return match === undefined ? fallback : { tier: match.tier, weight: match.weight };
  };
}
