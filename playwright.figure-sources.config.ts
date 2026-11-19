import { defineConfig } from '@playwright/test';

/* Serves the renderer's own figure-sources fixture page, so the check runs
   against the marks and popovers a user sees. */
export default defineConfig({
  testDir: './e2e', testMatch: 'figure-sources.spec.ts',
  workers: 1, timeout: 30_000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5363', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx vite src/renderer --host 127.0.0.1 --port 5363 --strictPort',
    url: 'http://127.0.0.1:5363/figure-sources-fixture.html',
    reuseExistingServer: !process.env.CI,
  },
});
