import { MAX_SNIPPET_LENGTH } from '@lfc/contracts';

/** Rough token estimate for German text; no tokenizer dependency in phase 1 (evidence-sources.md). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

// A sentence ends with . ! ? followed by space and an upper-case letter, digit or quote,
// unless the dot follows a one- or two-digit ordinal ("8. Mai", "3. Reich") or a single letter
// ("z. B."). Years ("1945.") do end a sentence.
const SENTENCE_END = /(?<!(?:^|[\s(])(?:\p{L}|\d{1,2}))([.!?])\s+(?=[\p{Lu}\d"„»])/gu;

export function splitSentences(paragraph: string): string[] {
  return paragraph
    .replace(SENTENCE_END, '$1\u0000')
    .split('\u0000')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export interface ChunkOptions {
  readonly targetTokens: number;
  readonly maxTokens: number;
  /** Sentences repeated at the start of the next chunk. */
  readonly overlapSentences: number;
}

/** Brief 9.2: sections of about 300–500 tokens with overlap. */
export const DEFAULT_CHUNKING: ChunkOptions = {
  targetTokens: 400,
  maxTokens: 500,
  overlapSentences: 1,
};

function hardSplit(sentence: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > maxChars) {
    const cut = rest.lastIndexOf(' ', maxChars);
    const at = cut > maxChars / 2 ? cut : maxChars;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest !== '') parts.push(rest);
  return parts;
}

/** Splits text into overlapping chunks along sentence boundaries. */
export function chunkText(text: string, options: ChunkOptions = DEFAULT_CHUNKING): string[] {
  const maxChars = options.maxTokens * 4;
  const sentences = text
    .split(/\n\s*\n/)
    .flatMap(splitSentences)
    .flatMap((sentence) =>
      sentence.length > maxChars ? hardSplit(sentence, maxChars) : [sentence],
    );

  const chunks: string[] = [];
  let current: string[] = [];
  let tokens = 0;
  for (const sentence of sentences) {
    const cost = estimateTokens(sentence) + 1;
    if (
      current.length > 0 &&
      (tokens + cost > options.maxTokens || tokens >= options.targetTokens)
    ) {
      chunks.push(current.join(' '));
      current = options.overlapSentences > 0 ? current.slice(-options.overlapSentences) : [];
      tokens = current.reduce((sum, s) => sum + estimateTokens(s) + 1, 0);
      if (tokens + cost > options.maxTokens) {
        current = [];
        tokens = 0;
      }
    }
    current.push(sentence);
    tokens += cost;
  }
  if (current.length > 0) chunks.push(current.join(' '));
  return chunks;
}

/**
 * A short, sentence-aligned excerpt for events and the UI (brief 9.2, `Evidence.snippet`):
 * whole sentences while they fit, otherwise the first sentence cut at a word boundary with "…".
 */
export function toSnippet(text: string, maxChars = MAX_SNIPPET_LENGTH): string {
  const sentences = splitSentences(text.replace(/\s+/g, ' ').trim());
  let snippet = '';
  for (const sentence of sentences) {
    const next = snippet === '' ? sentence : `${snippet} ${sentence}`;
    if (next.length > maxChars) break;
    snippet = next;
  }
  if (snippet !== '') return snippet;
  const first = sentences[0] ?? '';
  const cut = first.lastIndexOf(' ', maxChars - 1);
  return `${first.slice(0, cut > 0 ? cut : maxChars - 1).trimEnd()}…`;
}
