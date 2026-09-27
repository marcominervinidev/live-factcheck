/**
 * The normalised form of a claim: the key of deduplication and the exact verdict cache
 * (ADR 0008). Unicode NFKC, lower case, typographic quotes and dashes unified, whitespace
 * collapsed, trailing punctuation removed. Numbers and negations are kept on purpose, so
 * "endete 1945" and "endete 1965" or "ist" and "ist nicht" never share a verdict.
 * Lives here because the gateway is the only producer in phase 1; the claim-extractor
 * (phase 2) will share it through a package.
 */
export function normalizeClaimText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[„“”«»‚‘’]/g, '"')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.!?;:,]+$/u, '');
}
