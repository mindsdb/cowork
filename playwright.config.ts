import { defineConfig } from '@playwright/test';

// Requires npm run build; launches the built Electron app with test:e2e.
// Keep separate from Vitest because it needs a display.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // Use one worker: Electron and userData are singletons.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
