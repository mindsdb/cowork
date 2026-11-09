import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: 'collection-items.spec.ts',
  workers: 1, timeout: 30_000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5207', viewport: { width: 1024, height: 640 }, trace: 'retain-on-failure' },
  webServer: { command: 'npx vite --config e2e/collection-items/vite.config.ts', url: 'http://127.0.0.1:5207', reuseExistingServer: !process.env.CI },
});
