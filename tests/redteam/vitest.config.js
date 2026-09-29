import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The provider talks to a running stack; it is proven by the red-team runs in
      // docs/evidence/phase-1b/.
      exclude: ['src/**/*.test.ts', 'src/gateway-provider.ts'],
      reportsDirectory: 'reports/coverage',
      // Brief 13.5.
      thresholds: { lines: 80, branches: 80 },
    },
    projects: [{ extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'] } }],
  },
});
