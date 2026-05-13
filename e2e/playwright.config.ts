import { defineConfig } from '@playwright/test';

/**
 * Playwright config for Anton CoWork e2e tests.
 *
 * Runs against the web SPA mode (`npm run dev:web`), which boots
 * FastAPI + Vite and serves the same React UI as Electron — minus
 * the Electron-only gates (terms, installer, onboarding).
 *
 * Playwright's `webServer` starts `dev:web` automatically before
 * the test run and tears it down afterward.
 */
export default defineConfig({
  testDir: './flows',
  timeout: 30_000,
  retries: 0,
  reporter: [['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:5173',
    // Capture artifacts on failure for debugging.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],

  webServer: {
    command: 'npm run dev:web',
    url: 'http://localhost:5173',
    // dev:web boots FastAPI then Vite — give it time.
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PATH: `/opt/homebrew/opt/node@20/bin:${process.env.PATH}`,
    },
  },
});
