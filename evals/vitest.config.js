import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // run.ts and run-detection.ts are CLIs against a live stack, proven by dry runs (docs/evidence).
      exclude: ['src/**/*.test.ts', 'src/run.ts', 'src/run-detection.ts'],
      reportsDirectory: 'reports/coverage',
      // Brief 13.5; measured over unit and integration tests together (test:coverage where both exist).
      thresholds: { lines: 80, branches: 80 },
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: ['src/**/*.int.test.ts'] },
      },
    ],
  },
});
