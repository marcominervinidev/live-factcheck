// Stage 5 (brief 13.5): mutation testing shows whether the unit tests check the formatting, PCM encoding and store rules,
// not just run it. Runs nightly, not on every push. Command runner instead of the vitest
// runner: see packages/providers/stryker.config.mjs (runner 10.0.0 under Vitest 5 reports
// zero tests after the first run).
// Components are render-tested at stages 1/2b; worklet and microphone are the browser
// boundary (apps/web/AGENTS.md).
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: 'node_modules/.bin/vitest run --project unit' },
  coverageAnalysis: 'off',
  timeoutMS: 60_000,
  mutate: [
    'src/lib/format.ts',
    'src/audio/pcm.ts',
    'src/state/transcript.ts',
    'src/state/claims.ts',
  ],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 90, low: 78, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
