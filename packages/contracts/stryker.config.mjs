// Stage 5 (brief 13.5): mutation testing shows whether the contract tests really check the
// rules, not just execute them. Runs nightly, not on every push.
//
// Command runner instead of @stryker-mutator/vitest-runner: runner 10.0.0 (built against
// Vitest 4.1) reuses one Vitest instance, and under Vitest 5 every run after the first executes
// zero tests. Every mutant evaluated at test time then "survived" with testsCompleted: 0, which
// made the old score (34–45 %) meaningless. A fresh `vitest run` per mutant is slower but
// independent of Vitest internals; the mutant is activated through __STRYKER_ACTIVE_MUTANT__.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: 'node_modules/.bin/vitest run --project unit' },
  coverageAnalysis: 'off',
  // Each mutant starts Vitest anew; under parallel load that alone can exceed Stryker's default
  // timeout and would count a slow start as "detected".
  timeoutMS: 60_000,
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/testing/**', '!src/index.ts'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 90, low: 80, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
