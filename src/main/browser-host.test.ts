import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { BrowserWindow, IpcMain, Session } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../shared/ipc-channels';
import { fakeFactory } from '../../tests/browser-fake-tabs';

vi.mock('electron', () => ({ WebContentsView: class {}, nativeImage: {} }));

const { InAppBrowserHost, accountDownloadsFolder, uniqueDownloadPath } = await import('./browser-host');

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

function fakeSession(): Session {
  return {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    setDisplayMediaRequestHandler: vi.fn(),
    on: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() },
    getUserAgent: () => 'Mozilla/5.0 Chrome/142 Electron/39 Safari/537.36',
    setUserAgent: vi.fn(),
    cookies: { get: vi.fn(async () => []) },
    clearStorageData: vi.fn(async () => {}),
    clearCache: vi.fn(async () => {}),
    clearAuthCache: vi.fn(async () => {}),
  } as unknown as Session;
}

let root: string;
let stores: string | null;
let pushes: Array<{ url: string; token: string }>;
let host: InstanceType<typeof InAppBrowserHost>;
let factory: ReturnType<typeof fakeFactory>;
let profileSession: ReturnType<typeof vi.fn>;

function newHost(electronVersion: string | undefined) {
  return new InAppBrowserHost({
    serverPort: () => 26866,
    runningServerPort: () => 26866,
    authHeader: () => ({ Authorization: 'Bearer sidecar' }),
    accountRoot: () => root,
    storesRoot: () => stores,
    downloadsDir: () => root,
    profileSession: profileSession as unknown as (dir: string) => Session,
    fetch: (async (_url: string, init: RequestInit) => {
      pushes.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch,
    electronVersion: () => electronVersion,
    tabFactory: () => factory,
  });
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-host-'));
  stores = path.join(root, 'stores-a');
  pushes = [];
  factory = fakeFactory();
  profileSession = vi.fn(() => fakeSession());
  host = newHost('45.1.0');
  await host.start();
});

afterEach(async () => {
  await host.stop();
  fs.rmSync(root, { recursive: true, force: true });
});

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
    expect(await handlers[IPC.BROWSER_SHOW]({ senderFrame: (window as unknown as { webContents: { mainFrame: unknown } }).webContents.mainFrame }, 't-a', { x: 0, y: 0, width: 10, height: 10 })).toEqual({ exists: false });
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

describe('the pane IPC', () => {
  const CHANNELS: Array<[string, unknown[]]> = [
    [IPC.BROWSER_READY, []],
    [IPC.BROWSER_SHOW, ['t-a', { x: 0, y: 0, width: 10, height: 10 }]],
    [IPC.BROWSER_HIDE, []],
    [IPC.BROWSER_SET_BOUNDS, [{ x: 0, y: 0, width: 10, height: 10 }]],
    [IPC.BROWSER_NAVIGATE, ['t-a', 'back']],
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
    expect(handlers[IPC.BROWSER_SHOW](self, 't-a', { x: 10, y: 20, width: 300, height: 400 })).toEqual({ exists: true });
    expect(factory.tabs[0].show).toHaveBeenLastCalledWith({ x: 20, y: 40, width: 600, height: 800 });
    handlers[IPC.BROWSER_SET_BOUNDS](self, { x: 0, y: 0, width: 100.4, height: 50 });
    expect(factory.tabs[0].show).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 201, height: 100 });
    expect(() => handlers[IPC.BROWSER_SET_BOUNDS](self, { x: -1, y: 0, width: 1, height: 1 })).toThrow('bad bounds');
  });

  it('signs out of all sites: closes tasks, clears the profile and forgets the sites', async () => {
    const fake = fakeWindow();
    host.attachWindow(fake.window);
    const handlers = ipc();
    expect(await handlers[IPC.BROWSER_CLEAR_DATA]({ senderFrame: fake.mainFrame })).toEqual({ ok: true });
    const ses = profileSession.mock.results[0].value as Session;
    expect(ses.clearStorageData).toHaveBeenCalled();
    expect(ses.clearCache).toHaveBeenCalled();
    expect(profileSession).toHaveBeenCalledWith(path.join(root, 'browser'));
    expect(fs.statSync(path.join(root, 'browser')).mode & 0o777).toBe(0o700);
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
});

describe('downloads', () => {
  function fakeItem(filename: string) {
    let done: ((event: unknown, state: string) => void) | null = null;
    const item = {
      savePath: '',
      getFilename: () => filename,
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

  it('asks for a download no task owns', () => {
    const item = fakeItem('x.bin');
    host.placeDownload(root, item as never, undefined);
    expect(item.pause).toHaveBeenCalled();
    expect(item.savePath.startsWith(path.join(root, 'browser-downloads'))).toBe(true);
  });

  it('refuses a malformed answer', () => {
    const { window, mainFrame } = fakeWindow();
    host.attachWindow(window);
    const handlers = ipc();
    expect(() => handlers[IPC.BROWSER_ANSWER_DOWNLOAD]({ senderFrame: mainFrame }, 't-a', '../x', true)).toThrow('bad answer');
    expect(() => handlers[IPC.BROWSER_ANSWER_DOWNLOAD]({ senderFrame: mainFrame }, 't-a', '0123456789ab', 'yes')).toThrow('bad answer');
  });
});
