import { defineConfig, devices } from '@playwright/test';

// Release smoke: drives a REAL Chromium against the REAL CDN to check that the
// installers people actually download are published correctly. Nothing here is
// mocked or stubbed — a pass means downloads.mindshub.ai served it.
//
// Kept out of playwright.config.ts (and out of e2e/, which that config globs
// recursively) because the two suites have nothing in common: the Electron
// suite needs a build and no network, this one needs the network and no build.
// Run with `npm run test:release-smoke`.
export default defineConfig({
  testDir: './release-smoke',
  // One test downloads a 220 MB installer end to end over the public internet.
  timeout: 15 * 60_000,
  // Independent HTTP checks against a CDN — nothing shared to serialise on.
  fullyParallel: true,
  // A CDN download can fail for reasons that are not the release's fault.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: {
    trace: 'retain-on-failure',
  },
});
