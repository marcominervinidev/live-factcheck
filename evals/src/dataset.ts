import { readFileSync } from 'node:fs';

import { Verdict } from '@lfc/contracts';
import { z } from 'zod';

/** Slices for the report; `zahl` and `datum` watch Jev's documented weakness (classifier-jev.md). */
export const CATEGORIES = [
  'zahl',
  'datum',
  'person',
  'ort',
  'ereignis',
  'wissenschaft',
  'meinung',
  'prognose',
] as const;

export const ClaimItem = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  claim: z.string().trim().min(5).max(1_000),
  expected: Verdict,
  category: z.enum(CATEGORIES),
  /** Row in evals/SOURCES.md (origin and licence). */
  sourceId: z.string().min(1),
  /** Why the label is what it is; helps the owner's review. */
  note: z.string().min(1),
  /** Brief 13.5: an LLM or agent may propose labels; only owner-reviewed items count. */
  reviewed: z.boolean(),
});
export type ClaimItem = z.infer<typeof ClaimItem>;

/** Reads a JSONL file; every line must be a valid item and every id unique (fail fast). */
export function loadClaims(path: string): ClaimItem[] {
  const items: ClaimItem[] = [];
  const ids = new Set<string>();
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (line.trim() === '') return;
      const parsed = ClaimItem.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(
          `${path}:${String(index + 1)}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
        );
      }
      if (ids.has(parsed.data.id))
        throw new Error(`${path}:${String(index + 1)}: duplicate id ${parsed.data.id}`);
      ids.add(parsed.data.id);
      items.push(parsed.data);
    });
  return items;
}
