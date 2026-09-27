import type { SourceTier } from '@lfc/contracts';

/** A fetched and extracted source, before chunking. Its text is untrusted data. */
export interface SourceDocument {
  readonly url: string;
  readonly title: string;
  readonly publisher: string;
  readonly publishedAt?: string;
  readonly retrievedAt: string;
  readonly tier: SourceTier;
  /** Ranking weight of the tier from `config/source-tiers.yaml`. */
  readonly weight: number;
  readonly text: string;
}

/** An existing fact check (ClaimReview) from the Google Fact Check Tools API (brief 9.1). */
export interface FactCheckHit {
  /** The claim as the fact checker phrased it. */
  readonly claimText: string;
  readonly publisher: string;
  readonly url: string;
  readonly title?: string;
  /** Textual rating, e.g. "Falsch", "Irreführend". */
  readonly rating: string;
  readonly reviewDate?: string;
}

export interface CallOptions {
  readonly signal?: AbortSignal;
}
