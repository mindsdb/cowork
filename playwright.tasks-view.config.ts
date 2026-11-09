import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: 'tasks-view.spec.ts',
  workers: 1, timeout: 30_000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5361', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  webServer: { command: 'npx vite --config e2e/tasks-view/vite.config.ts', url: 'http://127.0.0.1:5361', reuseExistingServer: !process.env.CI },
});
