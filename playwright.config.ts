import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

const E2E_DIR = path.resolve(__dirname, 'e2e');

/** Returns the spec patterns that the browser-only fixture configs (`playwright.<name>.config.ts`
 *  pointing at e2e/) claim, so a new fixture is excluded here by adding its config alone.
 *  Evaluates each of those config modules; throws if one points at e2e/ without a testMatch. */
function browserFixtureSpecs(): (string | RegExp)[] {
  return fs
    .readdirSync(__dirname)
    .filter((file) => /^playwright\..+\.config\.ts$/.test(file))
    .flatMap((file) => {
      // A runtime require is the point here: the set of configs is discovered, not listed.
      const config: PlaywrightTestConfig = require(path.join(__dirname, file)).default;
      if (path.resolve(__dirname, config.testDir ?? '.') !== E2E_DIR) return [];
      if (!config.testMatch) throw new Error(`${file} points at e2e/ without a testMatch`);
      return [config.testMatch].flat();
    });
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
