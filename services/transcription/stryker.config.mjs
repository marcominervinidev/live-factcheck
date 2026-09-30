// Stage 5 (brief 13.5): mutation testing shows whether the unit tests check the number words and recording rules,
// not just run it. Runs nightly, not on every push. Command runner instead of the vitest
// runner: see packages/providers/stryker.config.mjs (runner 10.0.0 under Vitest 5 reports
// zero tests after the first run).
// main.ts and server.ts are wiring (integration + stage 3); probe.ts is a manual tool.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: 'node_modules/.bin/vitest run --project unit' },
  coverageAnalysis: 'off',
  timeoutMS: 60_000,
  mutate: ['src/numbers.ts', 'src/recording.ts'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 90, low: 80, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
