import { describe, expect, it } from 'vitest';

import { chunksFromDiff, isScannable, parseDiff } from './diff.js';

const DIFF = `diff --git a/services/gateway/src/api.ts b/services/gateway/src/api.ts
index 1111111..2222222 100644
--- a/services/gateway/src/api.ts
+++ b/services/gateway/src/api.ts
@@ -10,4 +10,5 @@ export function x() {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = request.query.url;
 const d = 4;
\\ No newline at end of file
@@ -40,2 +41,2 @@
 context only
 more context
diff --git a/docs/SECURITY.md b/docs/SECURITY.md
--- a/docs/SECURITY.md
+++ b/docs/SECURITY.md
@@ -1 +1 @@
+ignored
diff --git a/services/old.ts b/services/old.ts
--- a/services/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-gone
`;

describe('isScannable', () => {
  it.each([
    ['services/gateway/src/api.ts', true],
    ['apps/web/src/App.tsx', true],
    ['deploy/compose/caddy/Caddyfile', true],
    ['services/gateway/Dockerfile', true],
    ['.github/workflows/ci.yml', true],
    ['services/gateway/src/api.test.ts', false],
    ['services/gateway/src/api.int.test.ts', false],
    ['tests/api/edge.spec.ts', false],
    ['packages/providers/src/testing/fake-server.ts', false],
    ['pnpm-lock.yaml', false],
    ['docs/adr/0014-security-scanning-stack.md', false],
    ['scripts/llm-scan/reports/llm-scan.sarif', false],
  ])('%s → %s', (path, expected) => {
    expect(isScannable(path)).toBe(expected);
  });
});

describe('parseDiff', () => {
  it('numbers new-file lines and drops removed lines and deleted files', () => {
    const files = parseDiff(DIFF);
    expect([...files.keys()]).toEqual(['services/gateway/src/api.ts', 'docs/SECURITY.md']);
    expect(files.get('services/gateway/src/api.ts')).toEqual([
      { number: 10, added: false, code: 'const a = 1;' },
      { number: 11, added: true, code: 'const b = 3;' },
      { number: 12, added: true, code: 'const c = request.query.url;' },
      { number: 13, added: false, code: 'const d = 4;' },
      { number: 41, added: false, code: 'context only' },
      { number: 42, added: false, code: 'more context' },
    ]);
  });
});

describe('chunksFromDiff', () => {
  it('keeps only scannable files and hunks with new code, contiguous per hunk', () => {
    const chunks = chunksFromDiff(DIFF, 10_000);
    expect(chunks).toEqual([
      {
        file: 'services/gateway/src/api.ts',
        startLine: 10,
        endLine: 13,
        text: '10 | const a = 1;\n11+| const b = 3;\n12+| const c = request.query.url;\n13 | const d = 4;',
      },
    ]);
  });

  it('splits long hunks at the size limit', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `+const v${String(i)} = ${String(i)};`);
    const diff = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1,30 @@\n${lines.join('\n')}\n`;
    const chunks = chunksFromDiff(diff, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(200);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks.at(-1)?.endLine).toBe(30);
  });
});
