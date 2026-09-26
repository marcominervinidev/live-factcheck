import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';

export interface ExtractedDocument {
  readonly title: string;
  /** Main text, whitespace-normalised, paragraphs separated by blank lines. */
  readonly text: string;
  readonly publisher: string;
  readonly publishedAt?: string;
}

function hostPublisher(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

function normalise(text: string): string {
  return text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph !== '')
    .join('\n\n');
}

function isoOrUndefined(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value.trim() === '') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Main text of a fetched page via Readability on jsdom (brief 9.2). jsdom runs no scripts and
 * loads no resources by default; the virtual console swallows page CSS/JS noise. The result is
 * untrusted data and truncated to `maxChars`.
 */
export function extractDocument(
  html: string,
  url: string,
  maxChars: number,
): ExtractedDocument | undefined {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  try {
    const article = new Readability(dom.window.document).parse();
    const text = normalise(article?.textContent ?? '');
    if (text === '') return undefined;
    const publishedAt = isoOrUndefined(article?.publishedTime);
    return {
      title: (article?.title ?? '').trim() || hostPublisher(url),
      text: text.slice(0, maxChars),
      publisher: (article?.siteName ?? '').trim() || hostPublisher(url),
      ...(publishedAt === undefined ? {} : { publishedAt }),
    };
  } finally {
    dom.window.close();
  }
}
