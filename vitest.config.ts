import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// setupFiles must be set per project; root settings do not reach them.
export default defineConfig({
  plugins: [react()],
  test: {
    sequence: { setupFiles: 'list' },
    // Raise coverage floors as coverage grows; include the whole src tree so new untested modules
    // count.
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
        // Pin coverage for packaged-build validators.
        'src/main/provider-validation.ts': { statements: 86, branches: 80 },
        'src/main/minds-urls.ts': { statements: 96, branches: 89 },
        'src/main/server-source.ts': { statements: 100, branches: 90 },
        'src/shared/server-status.ts': { statements: 100, branches: 100 },
        'src/shared/minds-endpoint.ts': { statements: 100, branches: 100 },
        'src/main/server-process.ts': { statements: 60, branches: 45 },
        // Pin sign-out ordering: do not await restart, and always flush the previous user's
        // provider state.
        'src/main/sign-out.ts': { statements: 97, branches: 100 },
        'src/main/sign-out-restart.ts': { statements: 100, branches: 87 },
        'src/renderer/cowork/hooks/useLogout.js': { statements: 100, branches: 93 },
        'src/main/ui-updater.ts': { statements: 75, branches: 68 },
        'src/renderer/platform/host.ts': { statements: 38, branches: 32 },
        // Pin artifact liveness fail-open branches.
        'src/renderer/cowork/lib/artifactLiveness.js': { statements: 97, branches: 91 },
        'src/renderer/cowork/lib/artifactsStore.js': { statements: 85, branches: 74 },
        // Pin credential hand-over failures and clearing both stores on sign-out.
        'src/main/minds-credential.ts': { statements: 100, branches: 100 },
        // Pin stale-account/reachability guards and rename-stable tile colors.
        'src/renderer/cowork/hooks/useHubWorkspaces.js': { statements: 100, branches: 100 },
        'src/renderer/cowork/lib/letterTile.js': { statements: 100, branches: 100 },
        'src/renderer/cowork/components/WorkspaceSelector.jsx': { statements: 100, branches: 90 },
        // Pin organization selection so credentials cannot use the wrong payer.
        'src/shared/minds-orgs.ts': { statements: 100, branches: 100 },
        'src/renderer/cowork/hooks/useMindsOrgs.js': { statements: 100, branches: 100 },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
          setupFiles: ['tests/setup-env.ts'],
        },
      },
      {
        extends: true, // Inline projects do not inherit root plugins by default.
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
