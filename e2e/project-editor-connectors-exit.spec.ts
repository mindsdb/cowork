import { test, expect, _electron as electron } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// Leaving Connectors from the sidebar while a new project's editor is
// suspended must not leave a closed dialog mounted over the app. happy-dom has
// no animations, so Base UI's unmount path only runs for real in Chromium.

let server: ChildProcess | undefined;
let origin = '';


function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}


async function waitForServer(url: string, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The web renderer did not start at ${url}`);
}


test.beforeAll(async () => {
  const port = await freePort();
  origin = `http://localhost:${port}`;
  server = spawn(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), 'dev', 'src/renderer', '--port', String(port), '--strictPort'], {
    env: { ...process.env, BUILD_TARGET: 'web' },
    stdio: 'ignore',
  });
  await waitForServer(origin);
});


test.afterAll(() => {
  server?.kill();
});


test('leaving Connectors from the sidebar leaves no dialog over the app', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-project-editor-'));
  const { ELECTRON_RUN_AS_NODE: _drop, ...env } = process.env;
  const app = await electron.launch({
    args: [path.resolve('e2e/helpers/code-fixture-app.cjs')],
    env: { ...env, CODE_FIXTURE_PROFILE: profile, CODE_FIXTURE_URL: `${origin}/?codeFixture=new`, CODE_FIXTURE_WIDTH: '1280' },
  });
  try {
    const page = await app.firstWindow();
    const newProject = async () => {
      await page.getByRole('combobox', { name: 'Code Project' }).click();
      await page.getByRole('option', { name: 'New project' }).click();
      await expect(page.getByRole('dialog', { name: 'New code project' })).toBeVisible();
    };
    await newProject();
    await page.getByRole('button', { name: /Clone a repository/ }).click();
    await page.getByRole('button', { name: 'Connect GitHub' }).click();
    await page.getByRole('button', { name: /New code task/ }).first().click();
    await expect(page.locator('[role=dialog]')).toHaveCount(0);
    await newProject();
    await page.keyboard.press('Escape');
    await expect(page.locator('[role=dialog]')).toHaveCount(0);
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
