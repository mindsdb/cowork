import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { electronHostsInAppBrowser } from '../src/shared/browser-contract';

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
    if (url.pathname === '/features') {
      return void res.writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Features</title><p id="o"></p><script>document.getElementById("o").textContent = "SharedWorker: " + typeof SharedWorker</script>');
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

/* Marks the /form page's own window from main, so a reload, which drops the
   mark, shows. */
async function markPage(): Promise<void> {
  await app.evaluate(({ webContents }, at) => webContents.getAllWebContents().find((contents) => contents.getURL() === at)?.executeJavaScript('window.inAppBrowserE2eMark = "kept"'), `${origin}/form`);
  expect(await pageMark()).toBe('kept');
}

/* The /form page's mark, or null once the page reloaded. */
async function pageMark(): Promise<string | null> {
  return app.evaluate(({ webContents }, at) => webContents.getAllWebContents().find((contents) => contents.getURL() === at)?.executeJavaScript('window.inAppBrowserE2eMark ?? null') ?? 'no page', `${origin}/form`);
}

async function openAt(route: string): Promise<void> {
  expect((await act({ action: 'navigate', url: `${origin}${route}` })).status).toBe(200);
  await expect.poll(async () => (await page()).url).toBe(`${origin}${route}`);
}

test.describe.configure({ mode: 'serial' });

/* The host refuses to run below its Electron floor (electronHostsInAppBrowser
   in src/shared/browser-contract.ts), so on an older Electron there is nothing
   to drive. Raise the floor with Electron's support window; never lower it to
   make this spec run. */
const ELECTRON_VERSION: string = JSON.parse(fs.readFileSync(path.resolve('node_modules/electron/package.json'), 'utf-8')).version;
test.skip(!electronHostsInAppBrowser(ELECTRON_VERSION), `the in-app browser doesn't run on this checkout's Electron ${ELECTRON_VERSION}`);

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

test('turns shared workers off, since their WebSockets skip the request listener', async () => {
  await openAt('/features');
  await expect.poll(async () => (await page()).text).toContain('SharedWorker: undefined');
});

/* The app menu's Close and Reload take Command on macOS and Control elsewhere. */
const MENU_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

test("keeps the agent's close and reload chords in the page, away from the pane's claims and the app menu", async () => {
  await openAt('/form');
  await markPage();
  await shell.evaluate(() => { (window as any).inAppBrowserE2eMarker = 'kept'; });
  // A menu shortcut acts on the focused window.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
  for (const key of [`${MENU_MODIFIER}+w`, `${MENU_MODIFIER}+r`]) {
    const pressed = await act({ action: 'press', key });
    expect(pressed.status, pressed.body.toString()).toBe(200);
  }
  /* The page got both keys itself. The agent's keys never reach the view's
     before-input-event, where the pane claims a person's reload chord, and
     carry no native key code, so an unhandled one never reaches the menu.
     On macOS a key that main sends can't reach the menu either way, so the
     window checks below bite only outside it. */
  await expect.poll(() => ['w', 'r'].every((key) => log.some((e) => e.type === 'keydown' && e.key === key && e.isTrusted))).toBe(true);
  // Long enough for a menu shortcut to have closed or reloaded the window.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  expect(await shell.evaluate(() => (window as any).inAppBrowserE2eMarker)).toBe('kept');
  expect(await pageMark()).toBe('kept');
  expect((await page()).url).toBe(`${origin}/form`);
});

test("reloads the site, not the app, on the person's reload chord", async () => {
  await openAt('/form');
  await shell.evaluate((id) => (window as any).antontron.browser.show(id, { x: 400, y: 0, width: 800, height: 800 }), SESSION);
  await shell.evaluate(() => { (window as any).inAppBrowserE2eMarker = 'kept'; });
  const modifier = process.platform === 'darwin' ? 'meta' : 'control';
  for (const modifiers of [[modifier], [modifier, 'shift']] as Array<Array<'meta' | 'control' | 'shift'>>) {
    await markPage();
    // A person's keys, as the OS hands them to the focused view.
    await app.evaluate(({ BrowserWindow, webContents }, { at, held }) => {
      BrowserWindow.getAllWindows()[0]?.focus();
      const tab = webContents.getAllWebContents().find((contents) => contents.getURL() === at);
      tab?.focus();
      tab?.sendInputEvent({ type: 'keyDown', keyCode: 'R', modifiers: held });
      tab?.sendInputEvent({ type: 'keyUp', keyCode: 'R', modifiers: held });
    }, { at: `${origin}/form`, held: modifiers });
    await expect.poll(pageMark, { message: `${modifiers.join('+')}+R reloads the site` }).toBeNull();
  }
  /* The app stays as it was. On macOS a key that main sends can't reach the
     menu, so the poll above is what fails there without the pane's claim.
     Elsewhere the menu's Reload and Force Reload act on the focused view, the
     tab, so the site reloads with or without the claim; browser-view.test.ts
     covers the claim on every platform. */
  expect(await shell.evaluate(() => (window as any).inAppBrowserE2eMarker)).toBe('kept');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await shell.evaluate(() => (window as any).antontron.browser.hide());
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

test('shows the task in the pane, answers whether it draws, and hides it again', async () => {
  const shown = await shell.evaluate((id) => (window as any).antontron.browser.show(id, { x: 400, y: 0, width: 800, height: 800 }), SESSION);
  expect(shown).toEqual({ exists: true, drawn: true });
  // A stage under main's floor keeps the task shown, but nothing draws.
  expect(await shell.evaluate(() => (window as any).antontron.browser.setBounds({ x: 400, y: 0, width: 800, height: 150 }))).toEqual({ drawn: false });
  expect(await shell.evaluate(() => (window as any).antontron.browser.setBounds({ x: 400, y: 0, width: 800, height: 800 }))).toEqual({ drawn: true });
  const missing = await shell.evaluate(() => (window as any).antontron.browser.show('t-missing', { x: 400, y: 0, width: 800, height: 800 }));
  expect(missing).toEqual({ exists: false, drawn: false });
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
