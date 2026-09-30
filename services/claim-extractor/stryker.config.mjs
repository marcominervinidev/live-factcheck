// Stage 5 (brief 13.5, plan T5.6): mutation testing of the detection core – pre-filter,
// thresholds and the duplicate check – shows whether the unit tests check the rules, not just
// run them. Runs nightly, not on every push. Same command runner as packages/contracts (see
// the reason there): a fresh `vitest run` per mutant, limited to the two fast test files.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: {
    command: 'node_modules/.bin/vitest run --project unit src/detect.test.ts src/prefilter.test.ts',
  },
  coverageAnalysis: 'off',
  timeoutMS: 60_000,
  mutate: ['src/detect.ts', 'src/prefilter.ts'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 90, low: 80, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
