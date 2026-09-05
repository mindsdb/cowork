import { defineConfig, devices } from '@playwright/test';

// Checks real CDN installers. Separate from Electron smoke: requires network and a browser, but no
// app build.
export default defineConfig({
  testDir: './release-smoke',
  // Allow time for a full installer download over the public internet.
  timeout: 15 * 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: {
    trace: 'retain-on-failure',
  },
});
