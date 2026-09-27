import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/**
 * Constant-time token check (ADR 0011). Comparing SHA-256 digests keeps the comparison length
 * fixed, so neither the content nor the length of the expected token leaks through timing.
 */
export function tokenMatches(expected: string, given: string | undefined): boolean {
  if (given === undefined) return false;
  return timingSafeEqual(digest(expected), digest(given));
}

/** The token from an `Authorization: Bearer <token>` header, if well-formed. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? '');
  return match?.[1];
}
