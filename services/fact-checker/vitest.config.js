import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts is wiring only, tested as a real child process (main*.test.ts); v8 coverage does not follow child processes.
      exclude: ['src/**/*.test.ts', 'src/testing/**', 'src/main.ts'],
      reportsDirectory: 'reports/coverage',
      // Brief 13.5; measured over unit and integration tests together (test:coverage where both exist).
      thresholds: { lines: 80, branches: 80 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts'],
          // These tests start the service as a real child process (tsx); in the pre-commit hook
          // several services do that in parallel, which can exceed Vitest's 5 s default.
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'int',
          include: ['src/**/*.int.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
