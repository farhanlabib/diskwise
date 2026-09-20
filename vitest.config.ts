import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'e2e/**'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'packages/core/src/safety/**',
        'packages/core/src/execute/**',
        'packages/core/src/plan/**',
        'packages/core/src/rules/**',
        'packages/core/src/journal/**',
        'packages/core/src/redact.ts',
        'packages/server/src/security.ts',
        'packages/server/src/server.ts',
        'packages/server/src/jobs.ts',
        'packages/server/src/engine.ts',
        'packages/ui/src/lib/derive.ts',
        'packages/ui/src/lib/settings.ts',
      ],
      exclude: ['**/*.test.ts'],
      // Thresholds sit just under the measured coverage so a real regression
      // fails CI without ordinary churn tripping it.
      thresholds: {
        lines: 88,
        branches: 75,
        functions: 88,
        'packages/core/src/safety/**': { lines: 92, branches: 85, functions: 95 },
        'packages/core/src/execute/**': { lines: 80, branches: 72, functions: 80 },
        'packages/core/src/plan/**': { lines: 95, branches: 92, functions: 95 },
        'packages/core/src/rules/**': { lines: 92, branches: 75, functions: 95 },
        'packages/core/src/journal/**': { lines: 90, branches: 84, functions: 90 },
        'packages/core/src/redact.ts': { lines: 95, branches: 95, functions: 100 },
        'packages/server/src/security.ts': { lines: 95, branches: 88, functions: 95 },
        'packages/server/src/server.ts': { lines: 85, branches: 72, functions: 92 },
        'packages/ui/src/lib/**': { lines: 95, branches: 90, functions: 88 },
      },
    },
  },
});
