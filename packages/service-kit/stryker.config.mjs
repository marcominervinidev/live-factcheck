// Stage 5 (brief 13.5): mutation testing shows whether the unit tests check the config, logging, claims and ops-server rules,
// not just run it. Runs nightly, not on every push. Command runner instead of the vitest
// runner: see packages/providers/stryker.config.mjs (runner 10.0.0 under Vitest 5 reports
// zero tests after the first run).
// redis.ts (Testcontainers), lifecycle.ts (child processes) and bin/ are proven by
// integration tests; a unit-only run cannot kill their mutants.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: 'node_modules/.bin/vitest run --project unit' },
  coverageAnalysis: 'off',
  timeoutMS: 60_000,
  mutate: ['src/config.ts', 'src/logger.ts', 'src/claims.ts', 'src/http.ts'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 90, low: 80, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
