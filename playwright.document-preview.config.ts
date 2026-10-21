import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/*
 * Document preview suite, run by .github/workflows/document-preview.yml.
 *
 * - web: Chromium against the preview harness page, one spec per type under
 *   e2e/document-preview. The harness's Vite config serves that page on
 *   HARNESS_URL; until that config exists, no server starts and the project
 *   finds no specs.
 * - electron: the desktop isolation spec against the built app (needs
 *   `npm run build` first, like playwright.config.ts).
 *
 * The top-level testMatch names both, so playwright.config.ts leaves them out
 * of the Electron launch smoke.
 */
const HARNESS_VITE_CONFIG = 'e2e/document-preview/vite.config.ts';
const HARNESS_URL = 'http://127.0.0.1:5210';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['document-preview/**/*.spec.ts', 'document-preview-electron.spec.ts'],
  timeout: 60_000,
  // The Electron app is a singleton (one instance, one userData dir).
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'web',
      testDir: './e2e/document-preview',
      testMatch: '*.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: HARNESS_URL },
    },
    {
      name: 'electron',
      testMatch: 'document-preview-electron.spec.ts',
    },
  ],
  webServer: fs.existsSync(path.resolve(__dirname, HARNESS_VITE_CONFIG))
    ? { command: `npx vite --config ${HARNESS_VITE_CONFIG}`, url: HARNESS_URL, reuseExistingServer: !process.env.CI }
    : undefined,
});
