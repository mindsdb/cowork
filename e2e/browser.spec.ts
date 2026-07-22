import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// Browser bridge e2e: boots the REAL app (temp HOME → clean-slate profile) and
// drives an embedded tab through the agent-facing loopback bridge the way the
// cowork-server tools do: discover via ~/.cowork-dev/browser-bridge.json,
// authenticate, open a tab on a loopback page, read it, snapshot it, click a
// link, screenshot it — plus negative auth/scheme checks. Loopback only.
//
// Requires `npm run build` first (launches dist/main + bundled renderer).

let app: ElectronApplication;
let tmpHome: string;
let pageServer: http.Server;
let pagePort: number;

interface BridgeInfo { port: number; token: string; pid: number }

async function waitForFile(p: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(p)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for ${p}`);
}

async function bridgeCall(
  info: BridgeInfo,
  method: string,
  route: string,
  body?: unknown,
  authed = true,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://127.0.0.1:${info.port}${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(authed ? { authorization: `Bearer ${info.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test.afterEach(async () => {
  await app?.close().catch(() => {});
  if (pageServer) await new Promise((r) => pageServer.close(() => r(null)));
  if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('browser bridge: discovery, auth, tab lifecycle, read/snapshot/click/screenshot', async () => {
  test.setTimeout(90_000);
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-e2e-browser-'));

  // A loopback page the tab can load (two routes so click can navigate).
  pageServer = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/next') {
      res.end('<html><head><title>Next Page</title></head><body><h1>arrived at next</h1></body></html>');
    } else if (req.url === '/input') {
      // Records every input event (with isTrusted) into the DOM for readback.
      res.end(
        '<html><head><title>Input Recorder</title></head><body>' +
          '<input id="f" style="position:absolute;left:100px;top:100px;width:220px;height:30px">' +
          '<pre id="log"></pre>' +
          '<script>window.addEventListener("error",function(){});' +
          'for (const t of ["click","keydown","input","paste"]) {' +
          ' document.addEventListener(t, (e) => {' +
          '  const d = document.createElement("div");' +
          '  d.textContent = t + "|trusted=" + e.isTrusted + "|target=" + (e.target.id || e.target.tagName) + (e.clipboardData ? "|data=" + e.clipboardData.getData("text/plain") : "");' +
          '  document.getElementById("log").appendChild(d);' +
          ' }, true);' +
          '}</script>' +
          '</body></html>',
      );
    } else {
      res.end(
        '<html><head><title>Bridge Test</title></head><body>' +
          '<h1>hello cowork browser</h1><a href="/next">go next</a>' +
          '</body></html>',
      );
    }
  });
  await new Promise<void>((resolve) => pageServer.listen(0, '127.0.0.1', resolve));
  pagePort = (pageServer.address() as { port: number }).port;

  const { ELECTRON_RUN_AS_NODE: _stripped, ...cleanEnv } = process.env;
  app = await electron.launch({
    args: [path.resolve('dist/main/main/index.js')],
    env: {
      ...(cleanEnv as Record<string, string>),
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
  });
  await app.firstWindow();

  // Bridge discovery: unpackaged → dev home under the temp HOME.
  const discoveryPath = path.join(tmpHome, '.cowork-dev', 'browser-bridge.json');
  await waitForFile(discoveryPath);
  const info = JSON.parse(fs.readFileSync(discoveryPath, 'utf8')) as BridgeInfo;
  expect(info.port).toBeGreaterThan(0);
  expect(info.token).toMatch(/^[0-9a-f]{64}$/);
  expect(fs.statSync(discoveryPath).mode & 0o777).toBe(0o600);

  // Health is open; everything else requires the bearer token.
  const health = await bridgeCall(info, 'GET', '/health', undefined, false);
  expect(health.status).toBe(200);
  expect(health.json).toEqual({ ok: true });
  expect((await bridgeCall(info, 'GET', '/state', undefined, false)).status).toBe(401);
  expect((await bridgeCall(info, 'GET', '/state', undefined, true)).status).toBe(200);

  // Open a tab on the loopback page.
  const created = await bridgeCall(info, 'POST', '/tabs', { url: `http://127.0.0.1:${pagePort}/` });
  expect(created.status).toBe(200);
  const tabId = created.json.tabId as string;
  expect(tabId).toBeTruthy();

  // State settles on the loaded page.
  await expect
    .poll(async () => {
      const s = await bridgeCall(info, 'GET', '/state');
      const tab = s.json.tabs.find((t: any) => t.id === tabId);
      return tab && !tab.isLoading ? tab.title : null;
    }, { timeout: 15_000 })
    .toBe('Bridge Test');

  // Read extracts the page text.
  const read = await bridgeCall(info, 'GET', `/read?tabId=${tabId}`);
  expect(read.status).toBe(200);
  expect(read.json.title).toBe('Bridge Test');
  expect(read.json.text).toContain('hello cowork browser');

  // Snapshot finds the link; clicking it navigates the tab.
  const snap = await bridgeCall(info, 'GET', `/snapshot?tabId=${tabId}`);
  expect(snap.status).toBe(200);
  const link = snap.json.elements.find((e: any) => e.tag === 'a' && /go next/.test(e.text));
  expect(link).toBeTruthy();
  const clicked = await bridgeCall(info, 'POST', '/click', { tabId, index: link.index });
  expect(clicked.status).toBe(200);
  await expect
    .poll(async () => (await bridgeCall(info, 'GET', '/state')).json.tabs[0].url)
    .toBe(`http://127.0.0.1:${pagePort}/next`);

  // Screenshot on a never-visible tab is refused (capturePage would be 0x0) —
  // the agent learns to bring the tab on screen first.
  const shot = await bridgeCall(info, 'POST', '/screenshot', { tabId });
  expect(shot.status).toBe(400);
  expect(String(shot.json.error)).toContain('needs the tab on screen');

  // Scheme guard: file:// navigation is rejected, tab model unpoisoned.
  const blocked = await bridgeCall(info, 'POST', '/navigate', { tabId, url: 'file:///etc/passwd' });
  expect(blocked.status).toBe(400);
  expect(blocked.json.error).toBeTruthy();
  const after = await bridgeCall(info, 'GET', '/state');
  expect(after.json.tabs[0].url).toBe(`http://127.0.0.1:${pagePort}/next`);

  // Trusted input: click_at + insert_text + press land as trusted events on
  // the page (through the warmed hidden input window), and synthetic paste
  // delivers clipboardData.
  await bridgeCall(info, 'POST', '/navigate', { tabId, url: `http://127.0.0.1:${pagePort}/input` });
  await expect
    .poll(async () => (await bridgeCall(info, 'GET', '/state')).json.tabs[0].title)
    .toBe('Input Recorder');

  expect((await bridgeCall(info, 'POST', '/click-at', { tabId, x: 150, y: 115 })).status).toBe(200);
  expect((await bridgeCall(info, 'POST', '/insert-text', { tabId, text: 'via-bridge' })).status).toBe(200);
  expect((await bridgeCall(info, 'POST', '/press', { tabId, key: 'enter' })).status).toBe(200);
  expect((await bridgeCall(info, 'POST', '/paste', { tabId, text: 'tsv-a\ttsv-b' })).status).toBe(200);

  await expect
    .poll(async () => (await bridgeCall(info, 'GET', `/read?tabId=${tabId}`)).json.text)
    .toContain('input|trusted=true|target=f');
  const log = (await bridgeCall(info, 'GET', `/read?tabId=${tabId}`)).json.text;
  expect(log).toContain('click|trusted=true|target=f');
  expect(log).toContain('keydown|trusted=true');
  expect(log).toContain('paste|trusted=false');
  expect(log).toContain('tsv-a');
});
