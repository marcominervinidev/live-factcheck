// Stage 5 (brief 13.5): mutation testing shows whether the unit tests check the ranking, chunking, extraction and tier rules,
// not just run it. Runs nightly, not on every push. Command runner instead of the vitest
// runner: see packages/providers/stryker.config.mjs (runner 10.0.0 under Vitest 5 reports
// zero tests after the first run).
// cache.ts is the Redis wrapper, proven at stage 2a.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: 'node_modules/.bin/vitest run --project unit' },
  coverageAnalysis: 'off',
  timeoutMS: 60_000,
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/index.ts', '!src/cache.ts'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 70, low: 58, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
