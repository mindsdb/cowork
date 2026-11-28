import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { browserFixtureConfigs } from './e2e/helpers/fixture-configs';

/*
 * Every browser fixture suite in one run, for CI (`npm run test:fixtures`).
 *
 * Each `playwright.<name>.config.ts` that points at e2e/ becomes one project here,
 * with its own page server, base URL and viewport, so a new suite runs in CI by
 * adding its config alone. Each still runs on its own with its own config.
 *
 * document-preview is left out: document-preview.yml runs it, with an Electron
 * project this run has no build for. The suites' servers all start together, so
 * each needs its own port and its own Vite dependency cache (`cacheDir`).
 */
const suites = browserFixtureConfigs(__dirname, ['fixtures']).filter(({ name }) => name !== 'document-preview');

const webServers = (config: PlaywrightTestConfig) => [config.webServer ?? []].flat();

export default defineConfig({
  testDir: './e2e',
  // playwright.config.ts excludes the specs a fixture config claims.
  testMatch: suites.flatMap(({ config }) => [config.testMatch!].flat()),
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  projects: suites.map(({ name, config }) => ({
    name,
    testMatch: config.testMatch,
    timeout: config.timeout,
    use: config.use,
  })),
  webServer: suites.flatMap(({ config }) => webServers(config)),
});
