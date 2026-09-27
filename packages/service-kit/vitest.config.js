import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // lifecycle.ts and bin/healthcheck.ts are tested as real child processes (signals, exit codes; lifecycle.test.ts); v8 coverage does not follow child processes.
      exclude: [
        'src/**/*.test.ts',
        'src/testing/**',
        'src/index.ts',
        'src/lifecycle.ts',
        'src/bin/**',
      ],
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
          // lifecycle.test.ts starts real child processes; in the parallel pre-commit hook that
          // can exceed Vitest's 5 s default (same setting as the services).
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
