import { randomUUID } from 'node:crypto';

import type { EmbeddingProvider } from '@lfc/providers';
import { cosineSimilarity } from '@lfc/providers';

import { DEFAULT_CHUNKING, chunkText } from './chunk.js';
import type { SourceDocument } from './sources/types.js';

export interface RankedChunk {
  /** Becomes `Evidence.evidenceId` when the chunk is used. */
  readonly id: string;
  readonly document: SourceDocument;
  readonly text: string;
  /** Cosine similarity claim ↔ chunk. */
  readonly similarity: number;
  /** `similarity × tier weight`, the ranking key (brief 9.1). */
  readonly score: number;
}

export interface RankOptions {
  readonly topK: number;
  /** Bounds embedding cost: only the first chunks of each document are considered. */
  readonly maxChunksPerDocument: number;
  readonly signal?: AbortSignal;
}

/**
 * In-memory ranking for phase 1 (brief 9.3: chunks are ranked per claim and then discarded).
 * Kept behind this function so phase 4 can swap it for the evidence store (ADR 0013).
 */
export async function rankChunks(
  claim: string,
  documents: readonly SourceDocument[],
  embeddings: EmbeddingProvider,
  options: RankOptions,
): Promise<RankedChunk[]> {
  const candidates = documents.flatMap((document) =>
    chunkText(document.text, DEFAULT_CHUNKING)
      .slice(0, options.maxChunksPerDocument)
      .map((text) => ({ document, text })),
  );
  if (candidates.length === 0) return [];
  const signal = options.signal === undefined ? {} : { signal: options.signal };
  const [query, passages] = await Promise.all([
    embeddings.embedQuery(claim, signal),
    embeddings.embedPassages(
      candidates.map((c) => c.text),
      signal,
    ),
  ]);
  return candidates
    .map((candidate, i) => {
      const similarity = cosineSimilarity(query, passages[i] ?? []);
      return {
        id: randomUUID(),
        ...candidate,
        similarity,
        score: similarity * candidate.document.weight,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, options.topK);
}
