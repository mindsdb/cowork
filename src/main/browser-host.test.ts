import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { BrowserWindow, IpcMain, Session, WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, type Mock, type MockInstance, vi } from 'vitest';
import type { BrowserViewState } from '../shared/browser-contract';
import { IPC } from '../shared/ipc-channels';
import { fakeFactory } from '../../tests/browser-fake-tabs';
import { browserMemoryPartition, browserProfilePath } from './browser-profile';
import type { TabFactory, TabHooks } from './browser-sessions';
import { BrowserStore } from './browser-store';
import type { TabContext } from './browser-view';

vi.mock('electron', () => ({ WebContentsView: class {}, nativeImage: {} }));

/* Fails the removal of one path only, as a file another program holds open
   fails it on Windows. */
const failRemoval = vi.hoisted(() => ({ path: '' }));
vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>();
  const rmSync = ((target: fs.PathLike, options?: fs.RmOptions) => {
    if (target === failRemoval.path) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    actual.rmSync(target, options);
  }) as typeof actual.rmSync;
  return { ...actual, default: { ...actual, rmSync }, rmSync };
});

const { InAppBrowserHost, MAX_WAITING_DOWNLOADS, ReservedPaths, accountDownloadsFolder, uniqueDownloadPath } = await import('./browser-host');

type Handler = (event: { senderFrame: unknown }, ...args: unknown[]) => unknown;

function fakeWindow() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const contentsListeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const mainFrame = { name: 'main' };
  const window = {
    isDestroyed: () => false,
    on: (name: string, cb: (...args: unknown[]) => void) => { (listeners[name] ??= []).push(cb); },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: {
      mainFrame,
      isDestroyed: () => false,
      getZoomFactor: () => 2,
      send: vi.fn(),
      on: (name: string, cb: (...args: unknown[]) => void) => { (contentsListeners[name] ??= []).push(cb); },
    },
  };
  return {
    window: window as unknown as BrowserWindow,
    mainFrame,
    emit: (name: string, ...args: unknown[]) => listeners[name]?.forEach((cb) => cb(...args)),
    emitContents: (name: string, ...args: unknown[]) => contentsListeners[name]?.forEach((cb) => cb(...args)),
  };
}

function fakeSession() {
  return {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    setDisplayMediaRequestHandler: vi.fn(),
    on: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn(), onSendHeaders: vi.fn(), onCompleted: vi.fn(), onErrorOccurred: vi.fn() },
    getUserAgent: () => 'Mozilla/5.0 Chrome/142 Electron/39 Safari/537.36',
    setUserAgent: vi.fn(),
    cookies: { get: vi.fn(async () => []), flushStore: vi.fn(async () => {}) },
    clearStorageData: vi.fn(async () => {}),
    clearCache: vi.fn(async () => {}),
    clearAuthCache: vi.fn(async () => {}),
  };
}
type FakeSession = ReturnType<typeof fakeSession>;

/* Asks the request listener a session was given whether it cancels a page
   request. */
function requestListener(ses: FakeSession): (url: string) => Promise<boolean> {
  const listener = ses.webRequest.onBeforeRequest.mock.calls[0][1] as (details: { url: string }, callback: (r: { cancel?: boolean }) => void) => void;
  return (url) => new Promise((resolve) => listener({ url }, (r) => resolve(r.cancel === true)));
}

let root: string;
let accountRoot: string;
let sidecarRoot: string | null;
let stores: string | null;
let serverPort: number;
let pushes: Array<{ url: string; token: string }>;
/* The status the local server answers a registration with. */
let pushStatus: number;
let host: InstanceType<typeof InAppBrowserHost>;
let factory: ReturnType<typeof fakeFactory>;
/* Like session.fromPath and fromPartition: the same session for the same folder or partition. */
let sessions: Map<string, FakeSession>;
let profileSession: Mock<(dir: string) => Session>;
let memorySession: Mock<(partition: string) => Session>;
let markDownloaded: Mock<(file: string) => void>;
/* The pages the tabs were built with, in order. */
let pages: Array<{ contents: WebContents; hooks: TabHooks }>;

const userData = () => path.join(root, 'user-data');
const sessionAt = (key: string): FakeSession => {
  if (!sessions.has(key)) sessions.set(key, fakeSession());
  return sessions.get(key)!;
};

/* Tabs built the way ElectronTab builds them: on the profile session, each
   page registered with the host as its task's. */
function profileTabs(ctx: TabContext): TabFactory {
  return {
    create: (hooks, url) => {
      ctx.session();
      const contents = {} as WebContents;
      ctx.register(contents, hooks);
      pages.push({ contents, hooks });
      return factory.create(hooks, url);
    },
  };
}

function newHost(electronVersion: string | undefined) {
  return new InAppBrowserHost({
    serverPort: () => serverPort,
    runningServerPort: () => 26866,
    authHeader: () => ({ Authorization: 'Bearer sidecar' }),
    accountRoot: () => accountRoot,
    sidecarAccountRoot: () => (stores === null ? null : sidecarRoot),
    storesRoot: () => stores,
    downloadsDir: () => root,
    profileSession,
    memorySession,
    markDownloaded,
    fetch: (async (_url: string, init: RequestInit) => {
      pushes.push(JSON.parse(String(init.body)));
      return { ok: pushStatus === 200, status: pushStatus } as Response;
    }) as unknown as typeof fetch,
    electronVersion: () => electronVersion,
    userDataDir: userData,
    tabFactory: profileTabs,
  });
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-host-'));
  accountRoot = root;
  sidecarRoot = root;
  stores = path.join(root, 'stores-a');
  serverPort = 26866;
  pushes = [];
  pushStatus = 200;
  factory = fakeFactory();
  sessions = new Map();
  pages = [];
  profileSession = vi.fn((dir: string) => sessionAt(dir) as unknown as Session);
  memorySession = vi.fn((partition: string) => sessionAt(`memory:${partition}`) as unknown as Session);
  markDownloaded = vi.fn<(file: string) => void>();
  host = newHost('45.1.0');
  await host.start();
});

afterEach(async () => {
  await host.stop();
  failRemoval.path = '';
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

/* Opens a task through the bridge, as anton does. */
function open(sessionId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const req = http.request(`${host.bridgeUrl()}/sessions`, { method: 'POST', headers: { authorization: `Bearer ${host.currentToken()}`, 'content-type': 'application/json' } }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.end(JSON.stringify({ session_id: sessionId }));
  });
}

/* The diagnostics the host logged as warnings, as records. */
function warnings(warn: MockInstance): Array<{ logger: string; log_level: string; event: string }> {
  return warn.mock.calls.map(([line]) => JSON.parse(String(line)));
}

function ipc() {
  const handlers: Record<string, Handler> = {};
  host.registerIpc({ handle: (channel: string, handler: Handler) => { handlers[channel] = handler; } } as unknown as IpcMain);
  return handlers;
}

function status(url: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${url}/healthz`, { headers: { authorization: `Bearer ${token}` } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('the Electron floor', () => {
  it.each(['39.8.10', '43.2.0', undefined])('hosts nothing on Electron %s: no bridge and no registration', async (version) => {
    await host.stop();
    host = newHost(version);
    await host.start();
    const { window } = fakeWindow();
    host.attachWindow(window);
    expect(host.supported()).toBe(false);
    expect(host.bridgeUrl()).toBeNull();
    expect(await host.rendererIsReady()).toBe(false);
    expect(await host.serverStarted()).toBe(false);
    expect(pushes).toEqual([]);
  });

  it.each(['39.8.10', '43.2.0', undefined])('answers no browser channel on Electron %s', async (version) => {
    await host.stop();
    host = newHost(version);
    expect(Object.keys(ipc())).toEqual([]);
  });

  it('hosts the browser from Electron 44', async () => {
    await host.stop();
    host = newHost('44.0.0');
    await host.start();
    host.attachWindow(fakeWindow().window);
    await host.rendererIsReady();
    expect(host.bridgeUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(pushes).toEqual([{ url: host.bridgeUrl(), token: host.currentToken() }]);
  });
});

describe('registration', () => {
  it('pushes nothing before the UI is ready, then the address and key', async () => {
    const { window } = fakeWindow();
    host.attachWindow(window);
    await host.serverStarted();
    expect(pushes).toEqual([]);
    await host.rendererIsReady();
    expect(pushes).toEqual([{ url: host.bridgeUrl(), token: host.currentToken() }]);
    await host.serverStarted();
    expect(pushes).toHaveLength(2);
  });

  it('tells the UI each time the server takes the registration, and only then', async () => {
    const fake = fakeWindow();
    const registered = () => (fake.window.webContents.send as Mock).mock.calls.filter(([channel]) => channel === IPC.BROWSER_REGISTERED);
    host.attachWindow(fake.window);
    await host.serverStarted();
    expect(registered()).toEqual([]);
    await host.rendererIsReady();
    expect(registered()).toEqual([[IPC.BROWSER_REGISTERED]]);
    await host.serverStarted();
    expect(registered()).toHaveLength(2);

    pushStatus = 503;
    await host.serverStarted();
    expect(pushes).toHaveLength(3);
    expect(registered()).toHaveLength(2);
  });

  it('pushes nothing without a window', async () => {
    await host.rendererIsReady();
    await host.serverStarted();
    expect(pushes).toEqual([]);
  });

  it('changes the key on an account or organization switch, refusing the old one, and closes every task', async () => {
    const { window } = fakeWindow();
    host.attachWindow(window);
    await host.rendererIsReady();
    const old = host.currentToken();
    const handlers = ipc();
    expect(await status(host.bridgeUrl()!, old)).toBe(200);
    await new Promise<void>((resolve, reject) => {
      const req = http.request(`${host.bridgeUrl()}/sessions`, { method: 'POST', headers: { authorization: `Bearer ${old}`, 'content-type': 'application/json' } }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ session_id: 't-a' }));
    });
    expect(factory.tabs).toHaveLength(1);
    stores = path.join(root, 'stores-b');
    await host.serverStarted();
    expect(host.currentToken()).not.toBe(old);
    expect(pushes.at(-1)).toEqual({ url: host.bridgeUrl(), token: host.currentToken() });
    expect(await status(host.bridgeUrl()!, old)).toBe(401);
    expect(factory.tabs[0].close).toHaveBeenCalled();
    expect(await handlers[IPC.BROWSER_SHOW]({ senderFrame: (window as unknown as { webContents: { mainFrame: unknown } }).webContents.mainFrame }, 't-a', { x: 0, y: 0, width: 10, height: 10 })).toEqual({ exists: false, drawn: false });
  });

  it('keeps the key while the server is stopped', async () => {
    const { window } = fakeWindow();
    host.attachWindow(window);
    await host.rendererIsReady();
    const key = host.currentToken();
    stores = null;
    await host.rendererIsReady();
    expect(host.currentToken()).toBe(key);
  });

  it('clears the registration when the window closes, and answers 503 after', async () => {
    const fake = fakeWindow();
    host.attachWindow(fake.window);
    await host.rendererIsReady();
    fake.emit('closed');
    await vi.waitFor(() => expect(pushes.at(-1)).toEqual({ url: '', token: '' }));
    const reply = await new Promise<number>((resolve, reject) => {
      const req = http.request(`${host.bridgeUrl()}/sessions/t-a/page`, { headers: { authorization: `Bearer ${host.currentToken()}` } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(reply).toBe(503);
  });

  it('clears the registration when the UI reloads, until the new UI is ready', async () => {
    const fake = fakeWindow();
    host.attachWindow(fake.window);
    await host.rendererIsReady();
    fake.emitContents('did-start-navigation', { isMainFrame: false, isSameDocument: false });
    fake.emitContents('did-start-navigation', { isMainFrame: true, isSameDocument: true });
    expect(pushes).toHaveLength(1);
    fake.emitContents('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    await vi.waitFor(() => expect(pushes.at(-1)).toEqual({ url: '', token: '' }));
    await host.serverStarted();
    expect(pushes.at(-1)).toEqual({ url: '', token: '' });
    await host.rendererIsReady();
    expect(pushes.at(-1)).toEqual({ url: host.bridgeUrl(), token: host.currentToken() });
  });
});

describe('the profile', () => {
  const profileOf = (account: string) => sessionAt(browserProfilePath(userData(), account));

  it('locks the profile down once, and cancels page requests to the live server and bridge ports', async () => {
    host.attachWindow(fakeWindow().window);
    expect(await host.clearData()).toEqual({ ok: true });
    expect(await host.clearData()).toEqual({ ok: true });
    const ses = profileOf(root);
    for (const set of [ses.setPermissionRequestHandler, ses.setPermissionCheckHandler, ses.setDevicePermissionHandler, ses.setDisplayMediaRequestHandler, ses.webRequest.onBeforeRequest]) {
      expect(set).toHaveBeenCalledTimes(1);
    }
    expect(ses.setUserAgent).toHaveBeenCalledWith(expect.not.stringContaining('Electron'));
    const cancelled = requestListener(ses);
    expect(await cancelled(`http://127.0.0.1:${new URL(host.bridgeUrl()!).port}/healthz`)).toBe(true);
    expect(await cancelled('http://127.0.0.1:26866/api/v1/settings')).toBe(true);
    expect(await cancelled('http://127.0.0.1:3000/')).toBe(false);
    serverPort = 27001;
    expect(await cancelled('http://127.0.0.1:27001/')).toBe(true);
    expect(await cancelled('http://127.0.0.1:26866/')).toBe(false);
  });

  it('locks the profile down even when the staging cleanup fails, and logs the failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failRemoval.path = path.join(root, 'browser-downloads');
    host.attachWindow(fakeWindow().window);
    expect(await host.clearData()).toEqual({ ok: true });
    expect(await host.clearData()).toEqual({ ok: true });
    const ses = profileOf(root);
    expect(ses.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(ses.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
    expect(await requestListener(ses)('http://169.254.169.254/latest/meta-data/')).toBe(true);
    expect(warnings(warn).filter((r) => r.logger === 'main.browser-host' && r.event === 'browser_host_could_not_clear_staged_downloads')).toHaveLength(1);
  });

  it('writes the cleared cookies to disk before Sign out of all sites answers', async () => {
    await host.clearData();
    const ses = profileOf(root);
    expect(ses.cookies.flushStore).toHaveBeenCalledTimes(1);
    expect(ses.cookies.flushStore.mock.invocationCallOrder[0]).toBeGreaterThan(ses.clearStorageData.mock.invocationCallOrder[0]);
  });

  it("keeps a quarantined account's profile in memory, locked down, with nothing under userData", async () => {
    accountRoot = path.join(root, 'accounts', '_unresolved-1a2b3c4d');
    expect(await host.clearData()).toEqual({ ok: true });
    expect(profileSession).not.toHaveBeenCalled();
    expect(memorySession).toHaveBeenCalledWith(browserMemoryPartition(accountRoot));
    expect(sessionAt(`memory:${browserMemoryPartition(accountRoot)}`).webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(userData(), 'browser-profiles'))).toBe(false);
  });

  it("moves to the new account's profile on a switch, and back to the old one, configured once", async () => {
    const other = path.join(root, 'other-account');
    host.attachWindow(fakeWindow().window);
    await host.rendererIsReady();
    await open('t-a');
    expect(profileSession).toHaveBeenLastCalledWith(browserProfilePath(userData(), root));
    accountRoot = other;
    sidecarRoot = other;
    stores = path.join(other, 'stores');
    await host.serverStarted();
    expect(factory.tabs[0].close).toHaveBeenCalled();
    await open('t-b');
    expect(profileSession).toHaveBeenLastCalledWith(browserProfilePath(userData(), other));
    accountRoot = root;
    sidecarRoot = root;
    stores = path.join(root, 'stores-a');
    await host.serverStarted();
    await open('t-c');
    expect(profileSession).toHaveBeenLastCalledWith(browserProfilePath(userData(), root));
    const first = profileOf(root);
    expect(first.on.mock.calls.filter(([name]) => name === 'will-download')).toHaveLength(1);
    expect(first.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
  });

  it('stays on the account the sidecar serves when the sign-in moves ahead of it', async () => {
    const other = path.join(root, 'other-account');
    BrowserStore.forAccountRoot(root).noteSite('a.test', 'ada');
    BrowserStore.forAccountRoot(other).noteSite('b.test', 'bob');
    host.attachWindow(fakeWindow().window);
    await host.rendererIsReady();
    await open('t-a');
    const key = host.currentToken();
    // The person signs in as another account; the sidecar still serves the first.
    accountRoot = other;
    await host.rendererIsReady();
    await open('t-b');
    expect(host.currentToken()).toBe(key);
    expect(factory.tabs[0].close).not.toHaveBeenCalled();
    expect(profileSession).not.toHaveBeenCalledWith(browserProfilePath(userData(), other));
    const sites = await new Promise<Array<{ site: string }>>((resolve, reject) => {
      const req = http.request(`${host.bridgeUrl()}/sessions/t-b/sites`, { headers: { authorization: `Bearer ${key}` } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')).sites));
      });
      req.on('error', reject);
      req.end();
    });
    expect(sites.map((s) => s.site)).toEqual(['a.test']);
    // Sign out of all sites clears the profile in use and the signed-in account's.
    expect(await host.clearData()).toEqual({ ok: true });
    for (const ses of [profileOf(root), profileOf(other)]) {
      for (const clear of [ses.clearStorageData, ses.cookies.flushStore, ses.clearCache, ses.clearAuthCache]) {
        expect(clear).toHaveBeenCalledTimes(1);
      }
    }
    expect(profileOf(other).webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
    expect(BrowserStore.forAccountRoot(root).sites()).toEqual([]);
    expect(BrowserStore.forAccountRoot(other).sites()).toEqual([]);
    // The sidecar moves, and the browser with it.
    BrowserStore.forAccountRoot(other).noteSite('c.test', 'cy');
    sidecarRoot = other;
    stores = path.join(other, 'stores');
    await host.serverStarted();
    expect(host.currentToken()).not.toBe(key);
    await host.clearData();
    expect(profileSession).toHaveBeenLastCalledWith(browserProfilePath(userData(), other));
    expect(profileOf(root).clearStorageData).toHaveBeenCalledTimes(1);
    expect(BrowserStore.forAccountRoot(other).sites()).toEqual([]);
  });
});

describe('the pane IPC', () => {
  const CHANNELS: Array<[string, unknown[]]> = [
    [IPC.BROWSER_READY, []],
    [IPC.BROWSER_SHOW, ['t-a', { x: 0, y: 0, width: 10, height: 10 }]],
    [IPC.BROWSER_HIDE, []],
    [IPC.BROWSER_SET_BOUNDS, [{ x: 0, y: 0, width: 10, height: 10 }]],
    [IPC.BROWSER_NAVIGATE, ['t-a', 'back']],
    [IPC.BROWSER_OPEN, ['t-a', 'https://example.com']],
    [IPC.BROWSER_ACTIVATE_TAB, ['t-a', 't1']],
    [IPC.BROWSER_TAKE_OVER, ['t-a']],
    [IPC.BROWSER_HAND_BACK, ['t-a']],
    [IPC.BROWSER_ANSWER_LOGIN, ['t-a', null]],
    [IPC.BROWSER_ANSWER_DOWNLOAD, ['t-a', '0123456789ab', true]],
    [IPC.BROWSER_CLEAR_DATA, []],
  ];

  it('registers a handler for every browser channel the preload sends', () => {
    const handlers = ipc();
    expect(Object.keys(handlers).sort()).toEqual(CHANNELS.map(([c]) => c).sort());
  });

  it.each(CHANNELS)('refuses %s from any frame but the app\'s main frame', async (channel, args) => {
    const { window } = fakeWindow();
    host.attachWindow(window);
    const handlers = ipc();
    expect(() => handlers[channel]({ senderFrame: { name: 'document preview' } }, ...args)).toThrow('refused');
    expect(() => handlers[channel]({ senderFrame: null }, ...args)).toThrow('refused');
  });

  it('refuses every call once the window is gone', () => {
    const fake = fakeWindow();
    host.attachWindow(fake.window);
    const handlers = ipc();
    fake.emit('closed');
    expect(() => handlers[IPC.BROWSER_TAKE_OVER]({ senderFrame: fake.mainFrame }, 't-a')).toThrow('refused');
  });

  it('takes over and hands back for the person, from the main frame', async () => {
    const fake = fakeWindow();
    host.attachWindow(fake.window);
    const handlers = ipc();
    const self = { senderFrame: fake.mainFrame };
    await handlers[IPC.BROWSER_READY](self);
    await new Promise<void>((resolve, reject) => {
      const req = http.request(`${host.bridgeUrl()}/sessions`, { method: 'POST', headers: { authorization: `Bearer ${host.currentToken()}`, 'content-type': 'application/json' } }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ session_id: 't-a' }));
    });
    handlers[IPC.BROWSER_TAKE_OVER](self, 't-a');
    handlers[IPC.BROWSER_HAND_BACK](self, 't-a');
    const states = (fake.window.webContents.send as ReturnType<typeof vi.fn>).mock.calls.filter(([c]) => c === IPC.BROWSER_STATE).map(([, s]) => s);
    expect(states.at(-1).control).toMatchObject({ holder: 'agent', by: 'person', seq: 2 });
    expect(() => handlers[IPC.BROWSER_TAKE_OVER](self, '../etc')).toThrow('bad session id');
  });

  it('places the stage in the window\'s pixels, scaled by its zoom', async () => {
    const fake = fakeWindow();
    host.attachWindow(fake.window);
    const handlers = ipc();
    const self = { senderFrame: fake.mainFrame };
    await new Promise<void>((resolve, reject) => {
      const req = http.request(`${host.bridgeUrl()}/sessions`, { method: 'POST', headers: { authorization: `Bearer ${host.currentToken()}`, 'content-type': 'application/json' } }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ session_id: 't-a' }));
    });
    expect(handlers[IPC.BROWSER_SHOW](self, 't-a', { x: 10, y: 20, width: 300, height: 400 })).toEqual({ exists: true, drawn: true });
    expect(factory.tabs[0].show).toHaveBeenLastCalledWith({ x: 20, y: 40, width: 600, height: 800 });
    expect(handlers[IPC.BROWSER_SET_BOUNDS](self, { x: 0, y: 0, width: 150.4, height: 120 })).toEqual({ drawn: true });
    expect(factory.tabs[0].show).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 301, height: 240 });
    expect(() => handlers[IPC.BROWSER_SET_BOUNDS](self, { x: -1, y: 0, width: 1, height: 1 })).toThrow('bad bounds');
  });

  it('keeps a covered task shown but draws nothing while the pane reports an empty rectangle', async () => {
    const fake = fakeWindow();
    host.attachWindow(fake.window);
    const handlers = ipc();
    const self = { senderFrame: fake.mainFrame };
    await open('t-a');
    const empty = { x: 0, y: 0, width: 0, height: 0 };
    // The pane opens covered.
    expect(handlers[IPC.BROWSER_SHOW](self, 't-a', empty)).toEqual({ exists: true, drawn: false });
    expect(factory.tabs[0].show).not.toHaveBeenCalled();
    expect(handlers[IPC.BROWSER_SET_BOUNDS](self, { x: 10, y: 20, width: 300, height: 400 })).toEqual({ drawn: true });
    expect(factory.tabs[0].show).toHaveBeenLastCalledWith({ x: 20, y: 40, width: 600, height: 800 });
    expect(handlers[IPC.BROWSER_SET_BOUNDS](self, empty)).toEqual({ drawn: false });
    expect(factory.tabs[0].show).toHaveBeenCalledTimes(1);
    expect(factory.tabs[0].park).toHaveBeenLastCalledWith({ x: 20, y: 40, width: 600, height: 800 });
  });

  it('answers whether it draws at the stage, judged in the window\'s pixels after the zoom', async () => {
    // The fake window's zoom is 2, so the floor of 200 DIP is 100 CSS pixels.
    const fake = fakeWindow();
    host.attachWindow(fake.window);
    const handlers = ipc();
    const self = { senderFrame: fake.mainFrame };
    await open('t-a');
    // 90 CSS pixels tall is 180 DIP, under the floor.
    expect(handlers[IPC.BROWSER_SHOW](self, 't-a', { x: 10, y: 20, width: 300, height: 90 })).toEqual({ exists: true, drawn: false });
    expect(factory.tabs[0].show).not.toHaveBeenCalled();
    // 150 CSS pixels tall is 300 DIP, which draws.
    expect(handlers[IPC.BROWSER_SET_BOUNDS](self, { x: 10, y: 20, width: 300, height: 150 })).toEqual({ drawn: true });
    expect(factory.tabs[0].show).toHaveBeenLastCalledWith({ x: 20, y: 40, width: 600, height: 300 });
    expect(handlers[IPC.BROWSER_SET_BOUNDS](self, { x: 10, y: 20, width: 300, height: 90 })).toEqual({ drawn: false });
    expect(factory.tabs[0].show).toHaveBeenCalledTimes(1);
    // With no task shown, nothing draws.
    handlers[IPC.BROWSER_HIDE](self);
    expect(handlers[IPC.BROWSER_SET_BOUNDS](self, { x: 10, y: 20, width: 300, height: 150 })).toEqual({ drawn: false });
    expect(handlers[IPC.BROWSER_SHOW](self, 't-missing', { x: 10, y: 20, width: 300, height: 150 })).toEqual({ exists: false, drawn: false });
    expect(factory.tabs[0].show).toHaveBeenCalledTimes(1);
  });

  it('signs out of all sites: closes tasks, clears the profile and forgets the sites', async () => {
    const store = BrowserStore.forAccountRoot(root);
    store.noteSite('github.com', 'ada@example.com');
    store.saveTab('p-1', { name: 'Report', url: 'https://a.test/', notes: '' });
    const fake = fakeWindow();
    host.attachWindow(fake.window);
    await host.rendererIsReady();
    await open('t-a');
    const handlers = ipc();
    expect(await handlers[IPC.BROWSER_CLEAR_DATA]({ senderFrame: fake.mainFrame })).toEqual({ ok: true });
    expect(factory.tabs[0].close).toHaveBeenCalled();
    const dir = browserProfilePath(userData(), root);
    expect(profileSession).toHaveBeenCalledWith(dir);
    const ses = sessionAt(dir);
    // Every kind of storage, not a chosen few.
    expect(ses.clearStorageData).toHaveBeenCalledWith();
    expect(ses.clearCache).toHaveBeenCalled();
    expect(ses.clearAuthCache).toHaveBeenCalled();
    expect(store.sites()).toEqual([]);
    expect(store.savedTabs('p-1')).toHaveLength(1);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });
});

describe('uniqueDownloadPath', () => {
  it('keeps the name inside the folder and never overwrites', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'downloads-'));
    try {
      expect(uniqueDownloadPath(dir, '../../etc/passwd')).toBe(path.join(dir, 'passwd'));
      expect(uniqueDownloadPath(dir, '')).toBe(path.join(dir, 'download'));
      fs.writeFileSync(path.join(dir, 'report.pdf'), '');
      expect(uniqueDownloadPath(dir, 'report.pdf')).toBe(path.join(dir, 'report (1).pdf'));
      expect(uniqueDownloadPath(dir, 'C:\\Users\\x\\a.txt')).toBe(path.join(dir, 'a.txt'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips a reserved path as it skips one on disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'downloads-'));
    try {
      const reserved = new ReservedPaths();
      reserved.add(path.join(dir, 'report.pdf'));
      expect(uniqueDownloadPath(dir, 'report.pdf', reserved)).toBe(path.join(dir, 'report (1).pdf'));
      reserved.delete(path.join(dir, 'report.pdf'));
      expect(uniqueDownloadPath(dir, 'report.pdf', reserved)).toBe(path.join(dir, 'report.pdf'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips a reserved path that differs only in case or Unicode form, as macOS and Windows compare names', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'downloads-'));
    try {
      const reserved = new ReservedPaths();
      reserved.add(path.join(dir, 'report.pdf'));
      reserved.add(path.join(dir, 'café.pdf'));
      expect(uniqueDownloadPath(dir, 'Report.pdf', reserved)).toBe(path.join(dir, 'Report (1).pdf'));
      expect(uniqueDownloadPath(dir, 'café.pdf', reserved)).toBe(path.join(dir, 'café (1).pdf'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cuts a long name to 200 bytes between characters, keeping the extension, so the file can be written', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'downloads-'));
    try {
      const long = uniqueDownloadPath(dir, `${'a'.repeat(300)}.pdf`);
      expect(path.basename(long)).toBe(`${'a'.repeat(196)}.pdf`);
      fs.writeFileSync(long, '');
      const again = uniqueDownloadPath(dir, `${'a'.repeat(300)}.pdf`);
      expect(path.basename(again)).toBe(`${'a'.repeat(196)} (1).pdf`);
      fs.writeFileSync(again, '');
      // Four-byte characters are never cut in half.
      expect(path.basename(uniqueDownloadPath(dir, `${'\u{1F600}'.repeat(80)}.pdf`))).toBe(`${'\u{1F600}'.repeat(49)}.pdf`);
      // An extension too long to keep is cut with the rest of the name.
      expect(path.basename(uniqueDownloadPath(dir, `x.${'b'.repeat(300)}`))).toBe(`x.${'b'.repeat(198)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('downloads', () => {
  function fakeItem(filename: string, url = `https://files.test/${filename}`) {
    let done: ((event: unknown, state: string) => void) | null = null;
    const item = {
      savePath: '',
      getFilename: () => filename,
      getURL: () => url,
      setSavePath: vi.fn((p: string) => { item.savePath = p; }),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      once: vi.fn((name: string, cb: (event: unknown, state: string) => void) => { if (name === 'done') done = cb; }),
      finish(state: string) {
        if (state === 'completed') { fs.mkdirSync(path.dirname(item.savePath), { recursive: true }); fs.writeFileSync(item.savePath, 'pdf'); }
        done?.({}, state);
      },
    };
    return item;
  }
  function hooks(personHolds: boolean, sessionId = 't-a') {
    const seen: Array<{ id: string; name: string; folder: string; state: string }> = [];
    return { seen, hooks: { personHolds: () => personHolds, sessionId: () => sessionId, download: (d: { id: string; name: string; folder: string; state: string }) => seen.push(d) } as never };
  }
  const folder = () => path.join(root, 'Cowork browser');

  it("names the account's own folder inside Downloads", () => {
    expect(accountDownloadsFolder('/d', '/home/.cowork')).toBe(path.join('/d', 'Cowork browser'));
    expect(accountDownloadsFolder('/d', '/home/.cowork/accounts/acct-1234567890abcdef')).toBe(path.join('/d', 'Cowork browser acct-1234567'));
    // Two launches' quarantine roots never share a folder.
    expect(accountDownloadsFolder('/d', '/home/.cowork/accounts/_unresolved-1a2b3c4d')).toBe(path.join('/d', 'Cowork browser _unresolved-1a2b3c4d'));
    expect(accountDownloadsFolder('/d', '/home/.cowork/accounts/_unresolved-5e6f7a8b')).toBe(path.join('/d', 'Cowork browser _unresolved-5e6f7a8b'));
  });

  it("saves a download at once, into the account's folder, while the person holds the browser", () => {
    const item = fakeItem('report.pdf');
    const { seen, hooks: h } = hooks(true);
    host.placeDownload(root, item as never, h);
    expect(item.savePath).toBe(path.join(folder(), 'report.pdf'));
    expect(item.pause).not.toHaveBeenCalled();
    item.finish('completed');
    expect(seen.map((d) => d.state)).toEqual(['progressing', 'completed']);
    expect(fs.existsSync(path.join(folder(), 'report.pdf'))).toBe(true);
  });

  it("waits for the person's yes while the agent holds the browser, staged outside Downloads", () => {
    const item = fakeItem('invoice.pdf');
    const { seen, hooks: h } = hooks(false);
    host.placeDownload(root, item as never, h);
    expect(item.pause).toHaveBeenCalled();
    expect(item.savePath.startsWith(path.join(root, 'browser-downloads'))).toBe(true);
    expect(seen.at(-1)).toMatchObject({ name: 'invoice.pdf', folder: 'Cowork browser', state: 'waiting' });
    host.answerDownload('t-a', seen[0].id, true);
    expect(item.resume).toHaveBeenCalled();
    expect(fs.existsSync(path.join(folder(), 'invoice.pdf'))).toBe(false);
    item.finish('completed');
    expect(seen.at(-1)).toMatchObject({ state: 'completed' });
    expect(fs.existsSync(path.join(folder(), 'invoice.pdf'))).toBe(true);
    expect(fs.readdirSync(path.join(root, 'browser-downloads'))).toEqual([]);
  });

  it('cancels it and lands nothing when the person says no', () => {
    const item = fakeItem('invoice.pdf');
    const { seen, hooks: h } = hooks(false);
    host.placeDownload(root, item as never, h);
    host.answerDownload('t-a', seen[0].id, false);
    expect(item.cancel).toHaveBeenCalled();
    item.finish('cancelled');
    expect(seen.at(-1)).toMatchObject({ state: 'cancelled' });
    expect(fs.existsSync(folder())).toBe(false);
  });

  it('holds a download that finished before the answer, and places it or drops it on the answer', () => {
    const kept = fakeItem('a.pdf');
    const dropped = fakeItem('b.pdf');
    const a = hooks(false);
    const b = hooks(false);
    host.placeDownload(root, kept as never, a.hooks);
    host.placeDownload(root, dropped as never, b.hooks);
    kept.finish('completed');
    dropped.finish('completed');
    expect(fs.existsSync(folder())).toBe(false);
    host.answerDownload('t-a', a.seen[0].id, true);
    host.answerDownload('t-a', b.seen[0].id, false);
    expect(fs.readdirSync(folder())).toEqual(['a.pdf']);
    expect(b.seen.at(-1)).toMatchObject({ state: 'cancelled' });
    expect(fs.readdirSync(path.join(root, 'browser-downloads'))).toEqual([]);
  });

  it('downloads nothing when it has nowhere to put it', () => {
    const item = fakeItem('x.bin');
    const { seen, hooks: h } = hooks(true);
    fs.writeFileSync(path.join(root, 'Cowork browser'), 'a file where the folder goes');
    host.placeDownload(root, item as never, h);
    expect(item.cancel).toHaveBeenCalled();
    expect(item.setSavePath).not.toHaveBeenCalled();
    expect(seen.at(-1)).toMatchObject({ state: 'interrupted' });
  });

  it("takes an answer only from the download's own task", () => {
    const item = fakeItem('invoice.pdf');
    const { seen, hooks: h } = hooks(false, 't-a');
    host.placeDownload(root, item as never, h);
    host.answerDownload('t-b', seen[0].id, true);
    expect(item.resume).not.toHaveBeenCalled();
    host.answerDownload('t-a', seen[0].id, true);
    expect(item.resume).toHaveBeenCalled();
  });

  it("cancels a task's waiting downloads when the task closes", async () => {
    const { window } = fakeWindow();
    host.attachWindow(window);
    await host.rendererIsReady();
    await new Promise<void>((resolve, reject) => {
      const req = http.request(`${host.bridgeUrl()}/sessions`, { method: 'POST', headers: { authorization: `Bearer ${host.currentToken()}`, 'content-type': 'application/json' } }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ session_id: 't-a' }));
    });
    const item = fakeItem('invoice.pdf');
    host.placeDownload(root, item as never, hooks(false, 't-a').hooks);
    await host.clearData();
    expect(item.cancel).toHaveBeenCalled();
  });

  it('cancels a download no task owns, since no pane can ask about it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const item = fakeItem('x.bin');
    host.placeDownload(root, item as never, undefined);
    expect(item.cancel).toHaveBeenCalled();
    expect(item.setSavePath).not.toHaveBeenCalled();
    expect(item.pause).not.toHaveBeenCalled();
  });

  it("routes a page's download through the profile's own listener to the page's task", async () => {
    const fake = fakeWindow();
    host.attachWindow(fake.window);
    await host.rendererIsReady();
    await open('t-a');
    const listeners = sessionAt(browserProfilePath(userData(), root)).on.mock.calls.filter(([name]) => name === 'will-download');
    expect(listeners).toHaveLength(1);
    const willDownload = listeners[0][1] as (event: unknown, item: unknown, contents: WebContents) => void;
    const item = fakeItem('invoice.pdf');
    willDownload({}, item, pages[0].contents);
    expect(item.pause).toHaveBeenCalled();
    expect(item.savePath.startsWith(path.join(root, 'browser-downloads'))).toBe(true);
    const states = (fake.window.webContents.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([channel]) => channel === IPC.BROWSER_STATE)
      .map(([, state]) => state as BrowserViewState);
    expect(states.at(-1)).toMatchObject({ sessionId: 't-a', downloads: [{ name: 'invoice.pdf', state: 'waiting' }] });
  });

  it("cancels a task's download past MAX_WAITING_DOWNLOADS, and lets one wait again once one is answered", () => {
    const task = hooks(false, 't-a');
    const items = Array.from({ length: MAX_WAITING_DOWNLOADS + 1 }, (_, i) => fakeItem(`file ${i}.pdf`));
    for (const item of items) host.placeDownload(root, item as never, task.hooks);
    for (const item of items.slice(0, MAX_WAITING_DOWNLOADS)) expect(item.cancel).not.toHaveBeenCalled();
    const past = items[MAX_WAITING_DOWNLOADS];
    expect(past.cancel).toHaveBeenCalled();
    expect(past.setSavePath).not.toHaveBeenCalled();
    expect(task.seen.at(-1)).toMatchObject({ name: `file ${MAX_WAITING_DOWNLOADS}.pdf`, state: 'cancelled' });
    // Another task's downloads wait on their own count.
    const other = fakeItem('other.pdf');
    host.placeDownload(root, other as never, hooks(false, 't-b').hooks);
    expect(other.pause).toHaveBeenCalled();
    host.answerDownload('t-a', task.seen[0].id, false);
    const next = fakeItem('next.pdf');
    host.placeDownload(root, next as never, task.hooks);
    expect(next.pause).toHaveBeenCalled();
    expect(next.cancel).not.toHaveBeenCalled();
    expect(MAX_WAITING_DOWNLOADS).toBe(5);
  });

  it('gives two same-name downloads in flight two paths, and frees a path once its download ends', () => {
    // A download that waits for the person's answer, named before the two below start.
    const asked = hooks(false);
    const waiting = fakeItem('report.pdf');
    host.placeDownload(root, waiting as never, asked.hooks);
    expect(asked.seen.at(-1)).toMatchObject({ name: 'report.pdf', state: 'waiting' });
    const person = hooks(true);
    const first = fakeItem('report.pdf');
    const second = fakeItem('report.pdf');
    host.placeDownload(root, first as never, person.hooks);
    host.placeDownload(root, second as never, person.hooks);
    expect(first.savePath).toBe(path.join(folder(), 'report.pdf'));
    expect(second.savePath).toBe(path.join(folder(), 'report (1).pdf'));
    // Saved while both are in flight, it skips both of their paths.
    host.answerDownload('t-a', asked.seen[0].id, true);
    waiting.finish('completed');
    expect(asked.seen.at(-1)).toMatchObject({ name: 'report (2).pdf', state: 'completed' });
    first.finish('cancelled');
    const third = fakeItem('report.pdf');
    host.placeDownload(root, third as never, person.hooks);
    expect(third.savePath).toBe(path.join(folder(), 'report.pdf'));
  });

  it('marks each saved file at its final path', () => {
    const held = fakeItem('a.pdf');
    host.placeDownload(root, held as never, hooks(true).hooks);
    held.finish('completed');
    const asked = hooks(false);
    const waiting = fakeItem('b.pdf');
    host.placeDownload(root, waiting as never, asked.hooks);
    host.answerDownload('t-a', asked.seen[0].id, true);
    waiting.finish('completed');
    const dropped = fakeItem('c.pdf');
    host.placeDownload(root, dropped as never, hooks(true).hooks);
    dropped.finish('cancelled');
    expect(markDownloaded.mock.calls).toEqual([
      [path.join(folder(), 'a.pdf')],
      [path.join(folder(), 'b.pdf')],
    ]);
  });

  it('removes a saved file it cannot mark, and reports the download interrupted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    markDownloaded.mockImplementation(() => { throw new Error('xattr failed'); });
    const person = hooks(true);
    const held = fakeItem('a.pdf');
    host.placeDownload(root, held as never, person.hooks);
    held.finish('completed');
    expect(person.seen.at(-1)).toMatchObject({ name: 'a.pdf', state: 'interrupted' });
    const asked = hooks(false);
    const waiting = fakeItem('b.pdf');
    host.placeDownload(root, waiting as never, asked.hooks);
    host.answerDownload('t-a', asked.seen[0].id, true);
    waiting.finish('completed');
    expect(asked.seen.at(-1)).toMatchObject({ name: 'b.pdf', state: 'interrupted' });
    expect(fs.readdirSync(folder())).toEqual([]);
    expect(fs.readdirSync(path.join(root, 'browser-downloads'))).toEqual([]);
    expect(warnings(warn).filter((r) => r.event === 'browser_host_could_not_mark_a_download')).toHaveLength(2);
  });

  it('refuses a malformed answer', () => {
    const { window, mainFrame } = fakeWindow();
    host.attachWindow(window);
    const handlers = ipc();
    expect(() => handlers[IPC.BROWSER_ANSWER_DOWNLOAD]({ senderFrame: mainFrame }, 't-a', '../x', true)).toThrow('bad answer');
    expect(() => handlers[IPC.BROWSER_ANSWER_DOWNLOAD]({ senderFrame: mainFrame }, 't-a', '0123456789ab', 'yes')).toThrow('bad answer');
  });
});
