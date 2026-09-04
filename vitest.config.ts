import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two projects: main (node env) and renderer (happy-dom).
// setupFiles must be listed per project — root-level ones don't reach projects.
export default defineConfig({
  plugins: [react()],
  test: {
    sequence: { setupFiles: 'list' },
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
        // The validators a packaged build runs. They were inline in the IPC
        // handler and covered by nothing; pinned here so the tests that made
        // them assertable cannot quietly go away again.
        'src/main/provider-validation.ts': { statements: 86, branches: 80 },
        'src/main/minds-urls.ts': { statements: 96, branches: 89 },
        'src/main/server-source.ts': { statements: 100, branches: 90 },
        'src/shared/server-status.ts': { statements: 100, branches: 100 },
        'src/shared/minds-endpoint.ts': { statements: 100, branches: 100 },
        'src/main/server-process.ts': { statements: 60, branches: 45 },
        'src/main/ui-updater.ts': { statements: 75, branches: 68 },
        'src/renderer/platform/host.ts': { statements: 38, branches: 32 },
        // The liveness decision and its store. Pinned for the same reason as the
        // entries above: these exist because a stale artifact card shipped, and
        // the value is entirely in the branch table that proves each fail-open
        // guard still fires.
        'src/renderer/cowork/lib/artifactLiveness.js': { statements: 97, branches: 91 },
        'src/renderer/cowork/lib/artifactsStore.js': { statements: 85, branches: 74 },
        // The MindsHub credential hand-over. Nothing about it is visible at
        // runtime — a push that silently stops happening looks exactly like a
        // signed-out app — so the branch table is the only thing that proves
        // the sidecar-down, refusal and network-failure paths still return
        // false instead of throwing, and that sign-out clears both stores.
        'src/main/minds-credential.ts': { statements: 100, branches: 100 },
        // The workspace selector's two pure modules. Both are entirely
        // fail-closed logic: the hook decides whether a surface appears at all
        // and drops a read that resolved for the previous account, and the tile
        // decides a colour that must not move when a workspace is renamed.
        // Neither has a visible failure mode, so the branch table is the only
        // thing that proves the guards still fire.
        'src/renderer/cowork/hooks/useHubWorkspaces.js': { statements: 100, branches: 100 },
        'src/renderer/cowork/lib/letterTile.js': { statements: 100, branches: 100 },
        'src/renderer/cowork/components/WorkspaceSelector.jsx': { statements: 100, branches: 90 },
        // Which organization an API key is minted in. Same reasoning one level
        // up: a key in the wrong organization looks exactly like a key in the
        // right one until the bill arrives somewhere nobody expected.
        'src/shared/minds-orgs.ts': { statements: 100, branches: 100 },
        'src/renderer/cowork/hooks/useMindsOrgs.js': { statements: 100, branches: 100 },
        // Which account's data root the sidecar is pointed at, and the browser
        // caches that outlive a switch. Same reasoning as the entries above and
        // then some: every branch here is a fail-closed guard whose failure is
        // invisible at runtime — one account quietly reading another's tasks
        // looks exactly like reading its own. The branch table is the only thing
        // that proves the refusals still fire.
        'src/main/account-data.ts': { statements: 99, branches: 98 },
        'src/renderer/cowork/lib/accountLocalState.ts': { statements: 90, branches: 94 },
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
