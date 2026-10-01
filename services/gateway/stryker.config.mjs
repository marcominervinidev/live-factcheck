// Stage 5 (brief 13.5): mutation testing shows whether the unit tests check the audio, auth and session rules,
// not just run it. Runs nightly, not on every push. Command runner instead of the vitest
// runner: see packages/providers/stryker.config.mjs (runner 10.0.0 under Vitest 5 reports
// zero tests after the first run).
// api.ts, ws.ts and main.ts are wiring, proven by integration tests and stage 3.
// config.ts has no in-process unit test yet - mutating it would only restate that gap;
// tracked as a survivor-work candidate in issue #60.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: 'node_modules/.bin/vitest run --project unit' },
  coverageAnalysis: 'off',
  timeoutMS: 60_000,
  mutate: ['src/audio.ts', 'src/auth.ts', 'src/sessions.ts'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 60, low: 49, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
