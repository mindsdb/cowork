import { test, expect, _electron as electron } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// The composer lip clamps its text to two lines. happy-dom has no layout, so
// this renders the real lip in Chromium, with long copy in a narrow window.

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


test('keeps a long composer lip notice to two lines, with the full text on hover', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-lip-clamp-'));
  const { ELECTRON_RUN_AS_NODE: _drop, ...env } = process.env;
  const app = await electron.launch({
    args: [path.resolve('e2e/helpers/code-fixture-app.cjs')],
    env: { ...env, CODE_FIXTURE_PROFILE: profile, CODE_FIXTURE_URL: `${origin}/?codeFixture=long-notice`, CODE_FIXTURE_WIDTH: '760' },
  });
  try {
    const page = await app.firstWindow();
    const text = page.locator('.code-composer-lip__text');
    await expect(text).toBeVisible({ timeout: 30_000 });

    const layout = await text.evaluate((element) => {
      // The clipped box is what shows, so padding inside it would reveal a third line.
      return {
        lines: element.clientHeight / parseFloat(getComputedStyle(element).lineHeight),
        overflows: element.scrollHeight > element.clientHeight,
        title: element.getAttribute('title') || '',
      };
    });

    expect(layout.lines).toBeGreaterThan(1.9);
    expect(layout.lines).toBeLessThanOrEqual(2.05);
    // The copy is longer than two lines, so the clamp is what holds it there.
    expect(layout.overflows).toBe(true);
    expect(layout.title).toContain('Commit or stash them before merging.');
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
