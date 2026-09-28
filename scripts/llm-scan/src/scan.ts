// Asks the model about one chunk and keeps only findings it can point to (brief 15.7, ADR 0014).
import { randomBytes } from 'node:crypto';

import type { LlmProvider, TokenUsage } from '@lfc/providers';
import { LlmError, loadPromptTemplate, renderPrompt } from '@lfc/providers';
import { z } from 'zod';

import type { Chunk } from './diff.js';

export const Finding = z.strictObject({
  line: z.int().min(1),
  severity: z.enum(['high', 'medium', 'low']),
  cwe: z.string().regex(/^CWE-\d{1,5}$/),
  title: z.string().trim().min(3).max(120),
  explanation: z.string().trim().min(3).max(600),
});
export type Finding = z.infer<typeof Finding>;

const Answer = z.strictObject({ findings: z.array(Finding).max(10) });

export interface LocatedFinding extends Finding {
  readonly file: string;
}

export interface ChunkResult {
  readonly findings: readonly LocatedFinding[];
  /** Findings pointing outside the chunk's new lines: the model guessed, they are dropped. */
  readonly discarded: number;
  readonly usage: TokenUsage;
  /** Set when the model gave no valid answer; the chunk then counts as not scanned. */
  readonly error?: string;
}

const PROMPT = loadPromptTemplate(new URL('../prompts/scan.md', import.meta.url));

/** Lines the finding may point to: only new code in this chunk. */
function addedLines(chunk: Chunk): Set<number> {
  const lines = new Set<number>();
  for (const row of chunk.text.split('\n')) {
    const match = /^(\d+)\+\|/.exec(row);
    if (match !== null) lines.add(Number(match[1]));
  }
  return lines;
}

export async function scanChunk(
  llm: LlmProvider,
  chunk: Chunk,
  signal?: AbortSignal,
): Promise<ChunkResult> {
  const user = renderPrompt(PROMPT.user, {
    file: chunk.file,
    startLine: String(chunk.startLine),
    endLine: String(chunk.endLine),
    // A fresh suffix per request: the code cannot close the data block (same as the pipeline).
    nonce: randomBytes(8).toString('hex'),
    code: chunk.text,
  });
  try {
    const result = await llm.generateStructured(
      { task: 'scan', system: PROMPT.system, user, schema: Answer, maxTokens: 1_200 },
      signal === undefined ? {} : { signal },
    );
    const allowed = addedLines(chunk);
    const kept = result.value.findings.filter((finding) => allowed.has(finding.line));
    return {
      findings: kept.map((finding) => ({ ...finding, file: chunk.file })),
      discarded: result.value.findings.length - kept.length,
      usage: result.usage,
    };
  } catch (error) {
    if (!(error instanceof LlmError)) throw error;
    return { findings: [], discarded: 0, usage: error.usage, error: error.kind };
  }
}
