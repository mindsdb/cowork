import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Smoke-test the real main process and bundled renderer without depending on a particular first-run
// screen.
// Use a temporary HOME to exclude developer credentials, DEV_MODE redirects and cached UI.

// Allow only the missing-server health probe; broad network-error patterns could hide broken
// renderer chunks.
const BENIGN_CONSOLE = [/ERR_CONNECTION_REFUSED/i];

let app: ElectronApplication;
let tmpHome: string;
let tmpUserData: string;

test.afterEach(async () => {
  await app?.close().catch(() => {});
  if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
  if (tmpUserData) fs.rmSync(tmpUserData, { recursive: true, force: true });
});

test('app boots: window opens, React mounts, no uncaught errors', async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-e2e-'));
  tmpUserData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-e2e-user-data-')));
  // Strip inherited ELECTRON_RUN_AS_NODE so Electron accepts Playwright's debugging flags instead
  // of running as Node.
  const { ELECTRON_RUN_AS_NODE: _stripped, ...cleanEnv } = process.env;
  app = await electron.launch({
    args: [path.resolve('dist/main/main/index.js'), `--user-data-dir=${tmpUserData}`],
    env: {
      ...(cleanEnv as Record<string, string>),
      HOME: tmpHome, // clean-slate profile (macOS/Linux)
      USERPROFILE: tmpHome, // (Windows)
      COWORK_DEV_HOME: path.join(tmpHome, '.cowork-e2e'),
      // Suppress app.setName so it cannot replace Playwright's isolated user-data-dir with the
      // shared dev profile.
      COWORK_BUILD_KIND: 'prod',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
  });

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  const win: Page = await app.firstWindow();
  win.on('pageerror', (err) => pageErrors.push(String(err)));
  win.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // React mounted something real into #root (not just the static shell).
  await win.waitForSelector('#root > *', { state: 'attached', timeout: 30_000 });

  // Give the boot sequence a beat to surface late async errors, then judge.
  await win.waitForTimeout(2_000);

  expect(pageErrors, 'uncaught exceptions in the renderer').toEqual([]);
  const realErrors = consoleErrors.filter((t) => !BENIGN_CONSOLE.some((re) => re.test(t)));
  expect(realErrors, 'unexpected console errors (benign server-probe failures are allowed)').toEqual([]);
});
