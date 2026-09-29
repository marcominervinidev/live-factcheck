import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // run.ts is the CLI (git + a live model), proven by the run in docs/evidence/phase-1b/.
      exclude: ['src/**/*.test.ts', 'src/run.ts'],
      reportsDirectory: 'reports/coverage',
      // Brief 13.5.
      thresholds: { lines: 80, branches: 80 },
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts'] },
      },
    ],
  },
});
