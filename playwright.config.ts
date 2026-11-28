import { defineConfig } from '@playwright/test';
import { browserFixtureConfigs } from './e2e/helpers/fixture-configs';

/** The spec patterns the browser-only fixture configs claim, so a new fixture is
 *  excluded here by adding its config alone. */
function browserFixtureSpecs(): (string | RegExp)[] {
  return browserFixtureConfigs(__dirname).flatMap(({ config }) => [config.testMatch!].flat());
}

// E2E launch smoke (qa.md §5c Tier-2). Drives the REAL Electron app via
// Playwright's _electron API — no browser download needed, the electron
// binary comes from node_modules. Requires `npm run build` first (launches
// dist/main + bundled dist/renderer).
//
// Kept separate from Vitest: `npm test` never runs these (slow, needs a
// display); `npm run test:e2e` and the tests-e2e.yml workflow do.
export default defineConfig({
  testDir: './e2e',
  testIgnore: browserFixtureSpecs(),
  timeout: 60_000,
  // The app is a singleton (one Electron instance, one userData dir) —
  // parallel workers would fight over it.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0, // one retry absorbs cold-start flakes in CI
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    trace: 'retain-on-failure', // debuggable flakes: npx playwright show-trace
  },
});
