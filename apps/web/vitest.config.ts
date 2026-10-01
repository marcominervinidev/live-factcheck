import react from '@vitejs/plugin-react';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['development', ...defaultClientConditions] },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // The microphone and the AudioWorklet need a real browser: stage 2b (tests/recording.spec.ts).
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/testing/**',
        'src/main.tsx',
        'src/audio/microphone.ts',
        'src/audio/capture-worklet.ts',
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
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
