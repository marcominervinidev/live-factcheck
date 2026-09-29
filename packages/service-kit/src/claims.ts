/**
 * The normalised form of a claim: the key of deduplication and the exact verdict cache
 * (ADR 0008). Unicode NFKC, lower case, typographic quotes and dashes unified, whitespace
 * collapsed, trailing punctuation removed. Numbers and negations are kept on purpose, so
 * "endete 1945" and "endete 1965" or "ist" and "ist nicht" never share a verdict.
 * Shared by every producer of `ClaimDetected` (gateway text mode, claim-extractor), so a claim
 * typed and the same claim spoken hit the same cache entry.
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
