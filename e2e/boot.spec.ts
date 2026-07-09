import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Boot smoke (qa.md §5c Tier-2): the real main process + bundled renderer
// launch, a window opens, React mounts, and nothing crashes. Deliberately
// does NOT assert on any specific screen's content — with a clean HOME the
// app lands on the terms/onboarding flow, but that UI is free to change.
//
// A fresh temp HOME gives a deterministic first-run state: no ~/.anton/.env
// (no DEV_MODE redirect to a dev server, no consent, no keys), no ui-cache,
// and the test can never read or write the developer's real profile.

// The only benign console error on first boot: the health probe against the
// not-yet-installed server. Broader patterns (e.g. "Failed to load resource")
// would mask real 404s/missing chunks — the regressions this smoke exists for.
const BENIGN_CONSOLE = [/ERR_CONNECTION_REFUSED/i];

let app: ElectronApplication;
let tmpHome: string;

test.afterEach(async () => {
  await app?.close().catch(() => {});
  if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('app boots: window opens, React mounts, no uncaught errors', async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-e2e-'));
  // ELECTRON_RUN_AS_NODE leaks from IDE-spawned shells (VS Code sets it) and
  // makes the launched binary behave as plain Node — Electron then rejects
  // Playwright's --remote-debugging-port and the launch dies. Always strip.
  const { ELECTRON_RUN_AS_NODE: _stripped, ...cleanEnv } = process.env;
  app = await electron.launch({
    args: [path.resolve('dist/main/main/index.js')],
    env: {
      ...(cleanEnv as Record<string, string>),
      HOME: tmpHome, // clean-slate profile (macOS/Linux)
      USERPROFILE: tmpHome, // (Windows)
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
