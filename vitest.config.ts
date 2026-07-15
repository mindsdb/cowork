import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two projects: main (node env) and renderer (happy-dom).
// setupFiles must be listed per project — root-level ones don't reach projects.
export default defineConfig({
  plugins: [react()],
  test: {
    // Floors are measured values — raise them as coverage grows, never lower.
    // `include` = whole src tree, so new untested modules count against them.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx,js,jsx}'],
      exclude: ['**/*.test.*', '**/*.d.ts', 'src/**/main.tsx', 'src/**/*.config.*'],
      thresholds: {
        statements: 1.6,
        branches: 1.5,
        lines: 1.7,
        'src/main/update-logic.ts': { statements: 100, branches: 100 },
        'src/main/server-source.ts': { statements: 100, branches: 90 },
        'src/main/ui-updater.ts': { statements: 75, branches: 68 },
        'src/renderer/platform/host.ts': { statements: 38, branches: 32 },
      },
    },
    projects: [
      {
        extends: true, // inherit root plugins (react) + settings
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
          setupFiles: ['tests/setup-env.ts'],
        },
      },
      {
        extends: true, // inline projects do NOT inherit root plugins by default
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['src/renderer/**/*.test.{js,jsx,ts,tsx}'],
          setupFiles: ['tests/setup-env.ts', 'tests/setup-renderer.ts'],
        },
      },
    ],
  },
});
