// Stage 5 (brief 13.5): mutation testing shows whether the unit tests check the config, logging, claims and ops-server rules,
// not just run it. Runs nightly, not on every push. Command runner instead of the vitest
// runner: see packages/providers/stryker.config.mjs (runner 10.0.0 under Vitest 5 reports
// zero tests after the first run).
// lifecycle.ts and bin/ spawn child processes with an isolated env - a unit-only run
// cannot kill their mutants; streams.ts is integration-only (issue #60). redis.ts has a
// unit test for the credentials-in-URL guard and is mutated.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: 'node_modules/.bin/vitest run --project unit' },
  coverageAnalysis: 'off',
  timeoutMS: 60_000,
  mutate: ['src/config.ts', 'src/logger.ts', 'src/claims.ts', 'src/http.ts', 'src/redis.ts'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 80, low: 68, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
