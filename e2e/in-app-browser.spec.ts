import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

/*
 * The in-app browser through its real bridge, in real Electron: the host from
 * dist/main (helpers/in-app-browser-app.cjs) drives a WebContentsView on a
 * throwaway profile, and a fixture server records what the page saw. This
 * shows that the agent's input reaches pages as trusted events, that page
 * reads run, that only the person hands control back, and that popups and
 * sign-ins behave. It makes no bot-detection claims: Playwright's Electron
 * launcher adds --remote-debugging-port=0, so those checks belong to a plain
 * launch of a packaged build.
 */

interface LogEntry {
  type: string;
  isTrusted?: boolean;
  key?: string | null;
  target?: string | null;
  value?: unknown;
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  json: () => any;
}

const FIXTURE = fs.readFileSync(path.resolve('e2e/helpers/in-app-browser-fixture.html'));
const SESSION = 't-e2e0123456789abcdef0123';

let server: http.Server;
let origin: string;
let log: LogEntry[] = [];
let profile: string;
let app: ElectronApplication;
let shell: Page;
let bridge: { url: string; token: string };

async function startFixtureServer(): Promise<void> {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/log' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        log.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        res.writeHead(204).end();
      });
      return;
    }
    if (url.pathname === '/form') return void res.writeHead(200, { 'content-type': 'text/html' }).end(FIXTURE);
    if (url.pathname === '/popup') {
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Popup</title><p id="o"></p><script>document.getElementById("o").textContent = window.opener ? "has opener" : "no opener"</script>');
    }
    if (url.pathname === '/autopop') {
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Auto</title><script>setTimeout(() => window.open("/popup", "_blank"), 1500)</script>');
    }
    if (url.pathname === '/set-cookie') {
      return void res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'e2e=kept; Max-Age=3600; Path=/' }).end('<title>Set</title>set');
    }
    if (url.pathname === '/echo-cookie') {
      const cookie = (req.headers.cookie ?? '').replace(/[<>&]/g, '');
      return void res.writeHead(200, { 'content-type': 'text/html' }).end(`<title>Echo</title><p>cookie:[${cookie}]</p>`);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function launch(): Promise<void> {
  const { ELECTRON_RUN_AS_NODE: _dropped, ...env } = process.env;
  app = await electron.launch({
    args: [path.resolve('e2e/helpers/in-app-browser-app.cjs')],
    env: { ...(env as Record<string, string>), IN_APP_BROWSER_PROFILE: profile },
  });
  shell = await app.firstWindow();
  await expect.poll(() => app.evaluate(() => (globalThis as any).inAppBrowserE2e ?? null)).not.toBeNull();
  bridge = await app.evaluate(() => (globalThis as any).inAppBrowserE2e);
}

function call(method: string, route: string, body?: unknown): Promise<Reply> {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request(`${bridge.url}${route}`, {
      method,
      headers: { authorization: `Bearer ${bridge.token}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buffer, json: () => JSON.parse(buffer.toString('utf-8')) });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function page(): Promise<any> {
  const reply = await call('GET', `/sessions/${SESSION}/page`);
  expect(reply.status, reply.body.toString()).toBe(200);
  return reply.json();
}

async function act(step: Record<string, unknown>): Promise<Reply> {
  return call('POST', `/sessions/${SESSION}/action`, step);
}

async function element(name: string): Promise<number> {
  const found = (await page()).elements.find((e: { name: string }) => e.name === name);
  expect(found, `no element named ${name}`).toBeTruthy();
  return found.id;
}

async function openAt(route: string): Promise<void> {
  expect((await act({ action: 'navigate', url: `${origin}${route}` })).status).toBe(200);
  await expect.poll(async () => (await page()).url).toBe(`${origin}${route}`);
}

test.describe.configure({ mode: 'serial' });

/* The host refuses to run below Electron 44 (MIN_IN_APP_BROWSER_ELECTRON_MAJOR
   in src/shared/browser-contract.ts), so on an older Electron there is nothing
   to drive. Raise the floor with Electron's support window; never lower it to
   make this spec run. */
const ELECTRON_MAJOR = Number(JSON.parse(fs.readFileSync(path.resolve('node_modules/electron/package.json'), 'utf-8')).version.split('.')[0]);
test.skip(ELECTRON_MAJOR < 44, `the in-app browser needs Electron 44 or later; this checkout has Electron ${ELECTRON_MAJOR}`);

test.beforeAll(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'in-app-browser-e2e-'));
  await startFixtureServer();
  await launch();
  const opened = await call('POST', '/sessions', { session_id: SESSION, url: `${origin}/form` });
  expect(opened.status).toBe(201);
  await expect.poll(async () => (await page()).elements.length, { timeout: 15_000 }).toBeGreaterThan(3);
  await expect.poll(async () => (await page()).scroll.viewport, { timeout: 5_000 }).toBeGreaterThan(0);
});

test.afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  fs.rmSync(profile, { recursive: true, force: true });
});

test.beforeEach(() => {
  log = [];
});

test('reads the page from an isolated world, hiding the password', async () => {
  const snapshot = await page();
  expect(snapshot.scroll.viewport).toBeGreaterThan(0);
  const password = snapshot.elements.find((e: { name: string }) => e.name === 'Password');
  expect(password).toMatchObject({ role: 'textbox', type: 'password', value_hidden: true });
  expect(JSON.stringify(snapshot)).not.toContain('hunter2');
  expect(snapshot.challenges).toEqual([]);
});

test('clicks and double-clicks with trusted events', async () => {
  const go = await element('Go');
  const first = await act({ action: 'click', element: go });
  expect(first.status, first.body.toString()).toBe(200);
  await expect.poll(() => log.filter((e) => e.type === 'click' && e.target === 'go')).toHaveLength(1);
  expect(log.filter((e) => e.target === 'go').every((e) => e.isTrusted)).toBe(true);
  log = [];
  expect((await act({ action: 'click', element: go, clicks: 2 })).status).toBe(200);
  await expect.poll(() => log.some((e) => e.type === 'dblclick' && e.isTrusted)).toBe(true);
});

test('types key by key into a field, and refuses the password field', async () => {
  const name = await element('Name');
  expect((await act({ action: 'type', element: name, text: 'Ada' })).status).toBe(200);
  // Shift is held for the capital, as a person types it.
  await expect.poll(() => log.filter((e) => e.type === 'keydown' && e.target === 'name').map((e) => e.key)).toEqual(['Shift', 'A', 'd', 'a']);
  expect(log.filter((e) => e.target === 'name').every((e) => e.isTrusted)).toBe(true);
  const snapshot = await page();
  expect(snapshot.elements.find((e: { name: string }) => e.name === 'Name').value).toBe('Ada');

  log = [];
  const refused = await act({ action: 'type', element: await element('Password'), text: 'x' });
  expect(refused.status).toBe(403);
  expect(refused.json().error).toBe('password_field');
  expect(log.filter((e) => e.type === 'keydown')).toEqual([]);
});

test('selects an option, presses Enter, and scrolls with the wheel', async () => {
  expect((await act({ action: 'select', element: await element('Color'), value: 'Blue' })).status).toBe(200);
  expect((await page()).elements.find((e: { name: string }) => e.name === 'Color').value).toBe('Blue');
  expect((await act({ action: 'press', element: await element('Name'), key: 'Enter' })).status).toBe(200);
  await expect.poll(() => log.some((e) => e.type === 'keydown' && e.key === 'Enter' && e.isTrusted)).toBe(true);
  expect((await act({ action: 'scroll', direction: 'down', amount: 600 })).status).toBe(200);
  await expect.poll(async () => (await page()).scroll.y).toBeGreaterThan(0);
  expect(log.some((e) => e.type === 'wheel' && e.isTrusted)).toBe(true);
});

test('scrolls an element into view before clicking it', async () => {
  const far = await element('Far away');
  expect((await act({ action: 'click', element: far })).status).toBe(200);
  await expect.poll(() => log.some((e) => e.type === 'click' && e.target === 'far' && e.isTrusted)).toBe(true);
});

test('takes a labelled JPEG screenshot with its size', async () => {
  const shot = await call('GET', `/sessions/${SESSION}/screenshot?annotate=true&format=jpeg&quality=70`);
  expect(shot.status).toBe(200);
  expect(shot.headers['content-type']).toBe('image/jpeg');
  expect([...shot.body.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  expect(Number(shot.headers['x-image-width'])).toBeGreaterThan(100);
  expect(Number(shot.headers['x-image-width'])).toBeLessThanOrEqual(1024);
});

test('hands the browser to the person, and only their Done hands it back', async () => {
  const handed = await call('POST', `/sessions/${SESSION}/control`, { holder: 'human', reason: 'Please sign in' });
  expect(handed.json()).toMatchObject({ holder: 'human', by: 'agent' });
  expect((await call('GET', `/sessions/${SESSION}/page`)).status).toBe(409);
  const takeBack = await call('POST', `/sessions/${SESSION}/control`, { holder: 'agent', reason: '' });
  expect(takeBack.status).toBe(403);
  expect(takeBack.json().error).toBe('person_only');
  await shell.evaluate((id) => (window as any).antontron.browser.handBack(id), SESSION);
  const info = (await call('GET', `/sessions/${SESSION}`)).json();
  expect(info.control).toMatchObject({ holder: 'agent', by: 'person', seq: handed.json().seq + 1 });
});

test('shows the task in the pane and hides it again', async () => {
  const shown = await shell.evaluate((id) => (window as any).antontron.browser.show(id, { x: 400, y: 0, width: 800, height: 800 }), SESSION);
  expect(shown).toEqual({ exists: true });
  const missing = await shell.evaluate(() => (window as any).antontron.browser.show('t-missing', { x: 400, y: 0, width: 800, height: 800 }));
  expect(missing).toEqual({ exists: false });
  await shell.evaluate(() => (window as any).antontron.browser.hide());
});

test('opens a popup that follows a click as a tab, with its opener', async () => {
  await openAt('/form');
  expect((await act({ action: 'click', element: await element('Open popup') })).status).toBe(200);
  await expect.poll(async () => (await call('GET', `/sessions/${SESSION}/tabs`)).json().tabs.length).toBe(2);
  const tabs = (await call('GET', `/sessions/${SESSION}/tabs`)).json().tabs;
  // The agent holds the browser, so the popup opens in the background.
  expect(tabs.find((t: { active: boolean }) => t.active).id).toBe('t1');
  expect((await call('POST', `/sessions/${SESSION}/tabs/t2/activate`)).status).toBe(200);
  await expect.poll(async () => (await page()).text).toContain('has opener');
  expect((await call('DELETE', `/sessions/${SESSION}/tabs/t2`)).status).toBe(200);
});

test('refuses a popup that follows no input', async () => {
  await openAt('/autopop');
  await new Promise((resolve) => setTimeout(resolve, 2500));
  expect((await call('GET', `/sessions/${SESSION}/tabs`)).json().tabs).toHaveLength(1);
});

test('keeps a cookie across a restart, and Sign out of all sites clears it', async () => {
  await openAt('/set-cookie');
  await app.close();
  await launch();
  expect((await call('POST', '/sessions', { session_id: SESSION, url: `${origin}/echo-cookie` })).status).toBe(201);
  await expect.poll(async () => (await page()).text, { timeout: 15_000 }).toContain('cookie:[e2e=kept]');
  expect(await shell.evaluate(() => (window as any).antontron.browser.clearData())).toEqual({ ok: true });
  expect((await call('POST', '/sessions', { session_id: SESSION, url: `${origin}/echo-cookie` })).status).toBe(201);
  await expect.poll(async () => (await page()).text, { timeout: 15_000 }).toContain('cookie:[]');
});
