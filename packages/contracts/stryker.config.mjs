// Stage 5 (brief 13.5): mutation testing shows whether the contract tests really check the
// rules, not just execute them. Runs nightly, not on every push.
//
// Known issue (2026-09-25): Stryker 10 + Vitest 5 + zod 4 reports mutants in refine callbacks
// as "survived" although the tests kill them when the mutation is applied by hand (see
// .ai/plans/phase-0-fundament.md). Until that is understood the score is reported, not enforced.
import { fileURLToPath } from 'node:url';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  // pnpm's strict layout hides the plugin from Stryker's own lookup; resolve it from here.
  plugins: [fileURLToPath(import.meta.resolve('@stryker-mutator/vitest-runner'))],
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.js' },
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/testing/**', '!src/index.ts'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 90, low: 80, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
