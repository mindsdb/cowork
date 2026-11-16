import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: 'page-header.spec.ts',
  workers: 1, timeout: 30_000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5363', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  webServer: { command: 'npx vite --config e2e/page-header/vite.config.ts', url: 'http://127.0.0.1:5363', reuseExistingServer: !process.env.CI },
});
