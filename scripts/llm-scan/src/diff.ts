// Turns a unified diff into small, line-numbered chunks for the model (brief 15.7, ADR 0014).
// Only new code matters: added and context lines keep their line number in the new file,
// removed lines are left out. A chunk without an added line is not worth a model call.

export interface Chunk {
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
  /** `<line>| <code>` per line, `+` after the number marks an added line. */
  readonly text: string;
}

const SCANNABLE = /\.(ts|tsx|mts|js|mjs|cjs|sh|ya?ml)$|(^|\/)(Dockerfile|Caddyfile)$/;
const SKIPPED = [
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)(node_modules|dist|reports|coverage)\//,
  /^docs\//,
  /\.(test|int\.test|spec)\.tsx?$/,
  /(^|\/)src\/testing\//,
];

/** Production code and config only: tests, docs, lockfiles and generated files are skipped. */
export function isScannable(path: string): boolean {
  return SCANNABLE.test(path) && !SKIPPED.some((pattern) => pattern.test(path));
}

interface Line {
  readonly number: number;
  readonly added: boolean;
  readonly code: string;
}

/** Numbered new-file lines per file, from `git diff --unified=N`. */
export function parseDiff(diff: string): Map<string, Line[]> {
  const files = new Map<string, Line[]>();
  let current: Line[] | undefined;
  let next = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      current = undefined;
    } else if (raw.startsWith('+++ ')) {
      const path = raw.slice(4).replace(/^b\//, '');
      if (path === '/dev/null') {
        current = undefined;
      } else {
        current = [];
        files.set(path, current);
      }
    } else if (raw.startsWith('@@')) {
      const match = /\+(\d+)/.exec(raw);
      next = match === null ? 0 : Number(match[1]);
    } else if (current !== undefined && !raw.startsWith('---')) {
      if (raw.startsWith('+')) {
        current.push({ number: next++, added: true, code: raw.slice(1) });
      } else if (raw.startsWith(' ')) {
        current.push({ number: next++, added: false, code: raw.slice(1) });
      }
      // '-' (removed) and '\ No newline at end of file' carry no new-file line.
    }
  }
  return files;
}

const render = (line: Line) => `${String(line.number)}${line.added ? '+' : ' '}| ${line.code}`;

/** Splits every scannable file into chunks of at most `maxChars` that contain new code. */
export function chunksFromDiff(diff: string, maxChars: number): Chunk[] {
  const chunks: Chunk[] = [];
  for (const [file, lines] of parseDiff(diff)) {
    if (!isScannable(file)) continue;
    let batch: Line[] = [];
    let size = 0;
    const flush = () => {
      const first = batch[0];
      const last = batch.at(-1);
      if (first !== undefined && last !== undefined && batch.some((line) => line.added)) {
        chunks.push({
          file,
          startLine: first.number,
          endLine: last.number,
          text: batch.map(render).join('\n'),
        });
      }
      batch = [];
      size = 0;
    };
    for (const line of lines) {
      const length = render(line).length + 1;
      // A gap in the numbering starts a new hunk: keep chunks contiguous.
      const previous = batch.at(-1);
      if (
        size + length > maxChars ||
        (previous !== undefined && line.number !== previous.number + 1)
      ) {
        flush();
      }
      batch.push(line);
      size += length;
    }
    flush();
  }
  return chunks;
}
