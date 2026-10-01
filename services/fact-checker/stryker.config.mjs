// Stage 5 (brief 13.5): mutation testing shows whether the unit tests check the verdict pipeline,
// not just run it. Runs nightly, not on every push. Command runner instead of the vitest
// runner: see packages/providers/stryker.config.mjs (runner 10.0.0 under Vitest 5 reports
// zero tests after the first run).
// wiring.ts, questions.ts and main.ts are wiring and prompts, proven at stage 3.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  // Only the fast logic tests: main.test.ts spawns five child processes (~60 s under load)
  // and proves startup, not pipeline.ts - it would slow every mutant without killing one.
  commandRunner: {
    command:
      'node_modules/.bin/vitest run --project unit src/pipeline.test.ts src/config.test.ts src/wiring.test.ts',
  },
  coverageAnalysis: 'off',
  timeoutMS: 60_000,
  mutate: ['src/pipeline.ts'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 70, low: 57, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
