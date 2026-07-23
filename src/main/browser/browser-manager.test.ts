import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { MAX_TABS } from './browser-logic';

// Orchestration tests with electron mocked (token-store.test.ts pattern).
// WebContentsView/webContents are fakes backed by a real EventEmitter so the
// manager's event wiring runs for real; chrome-import is stubbed so tests
// never touch the developer's actual Chrome profile.

const h = vi.hoisted(() => {
  const base = `${process.env.TMPDIR || '/tmp'}/browser-manager-test-${process.pid}`;
  return {
    home: `${base}/cowork-home`,
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    sendSpy: vi.fn(),
    winDestroyed: { value: false },
    views: [] as Array<Record<string, unknown>>,
    menus: [] as unknown[],
    externalSpy: vi.fn(async () => {}),
    clipboardSpy: vi.fn(),
    popupSpy: vi.fn(),
    sessionPartition: { value: '' },
    permissionRequestHandler: { fn: null as null | ((wc: unknown, perm: string, cb: (ok: boolean) => void) => void) },
    permissionCheckHandler: { fn: null as null | (() => boolean) },
    downloadHandler: { fn: null as null | ((event: unknown, item: unknown) => void) },
    chromeImportSpy: vi.fn(
      async (): Promise<{ imported: number; profiles: string[]; sites: import('../../shared/browser-types').TopSite[] }> => ({
        imported: 0,
        profiles: [],
        sites: [],
      }),
    ),
    inputWindows: [] as Array<Record<string, unknown>>,
  };
});

vi.mock('electron', () => {
  // Required inside the factory: vi.mock calls are hoisted above imports.
  const { EventEmitter } = require('events') as typeof import('events');
  class FakeWebContents extends EventEmitter {
    loadURL = vi.fn(async () => {});
    close = vi.fn();
    reload = vi.fn();
    stop = vi.fn();
    openDevTools = vi.fn();
    inspectElement = vi.fn();
    executeJavaScript = vi.fn(async () => null);
    capturePage = vi.fn(async () => ({ isEmpty: () => false, toPNG: () => Buffer.from('png') }));
    isLoading = vi.fn(() => false);
    debugger = {
      isAttached: vi.fn(() => false),
      attach: vi.fn(),
      sendCommand: vi.fn(async () => undefined),
    };
    windowOpenHandler: ((details: { url: string }) => unknown) | null = null;
    navigationHistory = {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      goBack: vi.fn(),
      goForward: vi.fn(),
    };
    setWindowOpenHandler(fn: (details: { url: string }) => unknown) {
      this.windowOpenHandler = fn;
    }
  }
  class FakeWebContentsView {
    webContents = new FakeWebContents();
    setBounds = vi.fn();
    constructor() {
      h.views.push(this as unknown as Record<string, unknown>);
    }
  }
  return {
    WebContentsView: FakeWebContentsView,
    BrowserWindow: class {
      contentView: { children: unknown[]; addChildView(v: unknown): void; removeChildView(v: unknown): void };
      showInactive = vi.fn();
      hide = vi.fn();
      destroy = vi.fn();
      loadURL = vi.fn(async () => {});
      on = vi.fn();
      isDestroyed = vi.fn(() => false);
      constructor() {
        const children: unknown[] = [];
        this.contentView = {
          children,
          addChildView(v: unknown) {
            children.push(v);
          },
          removeChildView(v: unknown) {
            const i = children.indexOf(v);
            if (i >= 0) children.splice(i, 1);
          },
        };
        h.inputWindows.push(this as unknown as Record<string, unknown>);
      }
    },
    Menu: {
      buildFromTemplate: (template: unknown) => {
        h.menus.push(template);
        return { popup: h.popupSpy };
      },
    },
    clipboard: { writeText: h.clipboardSpy },
    shell: { openExternal: h.externalSpy },
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(channel, fn),
    },
    app: { getPath: (name: string) => `${h.home}/fake-${name}` },
    session: {
      fromPartition: (name: string) => {
        h.sessionPartition.value = name;
        return {
          setPermissionRequestHandler: (fn: unknown) => {
            h.permissionRequestHandler.fn = fn as never;
          },
          setPermissionCheckHandler: (fn: unknown) => {
            h.permissionCheckHandler.fn = fn as never;
          },
          on: (event: string, fn: unknown) => {
            if (event === 'will-download') h.downloadHandler.fn = fn as never;
          },
        };
      },
    },
  };
});

vi.mock('../cowork-home', () => ({ coworkHome: () => h.home }));
vi.mock('./chrome-import', () => ({ importChromeHistory: h.chromeImportSpy }));

type Manager = typeof import('./browser-manager');

function makeWindow() {
  return {
    isDestroyed: () => h.winDestroyed.value,
    webContents: { send: h.sendSpy },
    contentView: {
      children: [] as unknown[],
      addChildView(v: unknown) {
        this.children.push(v);
      },
      removeChildView(v: unknown) {
        const i = this.children.indexOf(v);
        if (i >= 0) this.children.splice(i, 1);
      },
    },
    getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
  };
}

let win: ReturnType<typeof makeWindow>;

async function loadManager(): Promise<Manager> {
  vi.resetModules();
  const mgr = await import('./browser-manager');
  mgr.registerBrowserHandlers(() => win as never);
  return mgr;
}

function fakeWc(index: number) {
  return h.views[index].webContents as unknown as EventEmitter & {
    loadURL: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    windowOpenHandler: ((d: { url: string }) => unknown) | null;
  };
}

const flush = (ms = 70) => new Promise((r) => setTimeout(r, ms));

const invoke = (channel: string, payload?: unknown): unknown =>
  h.handlers.get(channel)?.({}, payload);

beforeEach(() => {
  fs.rmSync(path.dirname(h.home), { recursive: true, force: true });
  fs.mkdirSync(h.home, { recursive: true });
  h.handlers.clear();
  h.views.length = 0;
  h.menus.length = 0;
  h.inputWindows.length = 0;
  h.sendSpy.mockClear();
  h.externalSpy.mockClear();
  h.clipboardSpy.mockClear();
  h.popupSpy.mockClear();
  h.sessionPartition.value = '';
  h.permissionRequestHandler.fn = null;
  h.permissionCheckHandler.fn = null;
  h.downloadHandler.fn = null;
  h.chromeImportSpy.mockClear();
  h.chromeImportSpy.mockResolvedValue({ imported: 0, profiles: [], sites: [] });
  h.winDestroyed.value = false;
  win = makeWindow();
});

afterEach(async () => {
  // Each loadManager() re-imports fresh module state; stop any bridge this
  // module instance started so ports don't leak between tests.
  const { stopBridge } = await import('./browser-bridge');
  await stopBridge();
});

describe('registerBrowserHandlers', () => {
  it('registers every browser IPC channel', async () => {
    await loadManager();
    for (const ch of [
      'browser:get-state', 'browser:set-visible', 'browser:set-bounds', 'browser:new-tab',
      'browser:close-tab', 'browser:activate-tab', 'browser:pin-tab', 'browser:navigate', 'browser:go-back',
      'browser:go-forward', 'browser:reload', 'browser:stop', 'browser:open-devtools',
      'browser:top-sites', 'browser:import-chrome',
      'browser:apps-list', 'browser:apps-add', 'browser:apps-remove', 'browser:apps-rename', 'browser:open-app',
    ]) {
      expect(h.handlers.has(ch), ch).toBe(true);
    }
  });
});

describe('tabs', () => {
  it('new-tab normalizes the url, creates a view, and pushes state (debounced)', async () => {
    const mgr = await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'example.com' })) as { tabId: string };
    expect(tabId).toBeTruthy();
    expect(h.views).toHaveLength(1);
    expect(fakeWc(0).loadURL).toHaveBeenCalledWith('https://example.com');

    const state = mgr.getBrowserState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ id: tabId, url: 'https://example.com', title: '' });
    expect(state.activeTabId).toBe(tabId);
    expect(state.viewVisible).toBe(false); // never made visible

    await flush();
    expect(h.sendSpy).toHaveBeenCalledWith('browser:state-changed', expect.objectContaining({ tabs: expect.any(Array) }));
  });

  it('a blank new tab stays view-less until it has something to show', async () => {
    await loadManager();
    await invoke('browser:new-tab', {});
    expect(h.views).toHaveLength(0);
  });

  it('a hidden tab with a url still gets a default viewport (background screenshots/snapshots)', async () => {
    await loadManager();
    await invoke('browser:new-tab', { url: 'https://a.com' });
    // Never attached, no bounds ever sent — but the view must not be 0x0.
    expect(h.views[0].setBounds as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
      x: 0, y: 0, width: 1280, height: 800,
    });
  });

  it('new-tab rejects disallowed schemes without creating the tab', async () => {
    const mgr = await loadManager();
    await expect(invoke('browser:new-tab', { url: 'javascript:alert(1)' })).rejects.toThrow('url not allowed');
    await expect(invoke('browser:new-tab', { url: 'file:///etc/passwd' })).rejects.toThrow('url not allowed');
    expect(mgr.getBrowserState().tabs).toEqual([]);
    expect(h.views).toHaveLength(0);
  });

  it(`new-tab caps the tab count at ${MAX_TABS}`, async () => {
    const mgr = await loadManager();
    for (let i = 0; i < MAX_TABS; i++) await invoke('browser:new-tab', {}); // blank = view-less
    expect(mgr.getBrowserState().tabs).toHaveLength(MAX_TABS);
    await expect(invoke('browser:new-tab', {})).rejects.toThrow('tab limit reached');
    expect(mgr.getBrowserState().tabs).toHaveLength(MAX_TABS);
  });

  it('set-visible attaches only the active view; bounds clamp to the window', async () => {
    await loadManager();
    const { tabId: a } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    await invoke('browser:new-tab', { url: 'https://b.com' });
    await invoke('browser:activate-tab', { tabId: a });

    await invoke('browser:set-visible', { visible: true, bounds: { x: 10, y: 20, width: 500, height: 400 } });
    expect(win.contentView.children).toHaveLength(1);
    expect(win.contentView.children[0]).toBe(h.views[0]);
    expect((h.views[0].setBounds as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ x: 10, y: 20, width: 500, height: 400 });

    // Oversized bounds clamp into the 1000x700 content area.
    await invoke('browser:set-bounds', { x: 900, y: 600, width: 5000, height: 5000 });
    expect((h.views[0].setBounds as ReturnType<typeof vi.fn>)).toHaveBeenLastCalledWith({ x: 900, y: 600, width: 100, height: 100 });

    // Negative coords clamp to 0.
    await invoke('browser:set-bounds', { x: -50, y: -5, width: 200, height: 100 });
    expect((h.views[0].setBounds as ReturnType<typeof vi.fn>)).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('activating another tab swaps the attached view; hiding detaches but keeps it alive', async () => {
    await loadManager();
    const { tabId: a } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    const { tabId: b } = (await invoke('browser:new-tab', { url: 'https://b.com' })) as { tabId: string };
    await invoke('browser:set-visible', { visible: true, bounds: { x: 0, y: 0, width: 800, height: 600 } });
    expect(win.contentView.children).toEqual([h.views[1]]); // b active

    await invoke('browser:activate-tab', { tabId: a });
    expect(win.contentView.children).toEqual([h.views[0]]);
    expect(fakeWc(1).close).not.toHaveBeenCalled(); // b's webContents stays alive

    await invoke('browser:set-visible', { visible: false });
    expect(win.contentView.children).toEqual([]);
    expect(fakeWc(0).close).not.toHaveBeenCalled();
    expect(h.handlers.has('browser:get-state')).toBe(true);
    expect(b).toBeTruthy();
  });

  it('re-attaches fully when the window instance is recreated (macOS activate)', async () => {
    await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    await invoke('browser:set-visible', { visible: true, bounds: { x: 0, y: 0, width: 800, height: 600 } });
    expect(win.contentView.children).toEqual([h.views[0]]);
    const oldWin = win;

    // Dock click after close: createWindow() makes a NEW BrowserWindow. The
    // recorded attachedTabId still matches, so attach() must detect the
    // instance swap and re-parent the view instead of no-op'ing.
    win = makeWindow();
    await invoke('browser:set-visible', { visible: true, bounds: { x: 0, y: 0, width: 800, height: 600 } });
    expect(win.contentView.children).toEqual([h.views[0]]);
    expect(oldWin.contentView.children).toEqual([]); // pulled off the stale window

    // Same-window re-attach is still a no-op (no duplicate addChildView).
    await invoke('browser:activate-tab', { tabId });
    expect(win.contentView.children).toEqual([h.views[0]]);
  });

  it('closing the active tab activates the nearest survivor; closing the last empties state', async () => {
    const mgr = await loadManager();
    const ids: string[] = [];
    for (const u of ['https://a.com', 'https://b.com', 'https://c.com']) {
      ids.push(((await invoke('browser:new-tab', { url: u })) as { tabId: string }).tabId);
    }
    await invoke('browser:set-visible', { visible: true, bounds: { x: 0, y: 0, width: 800, height: 600 } });
    await invoke('browser:activate-tab', { tabId: ids[1] });
    expect(win.contentView.children).toEqual([h.views[1]]);

    const res = (await invoke('browser:close-tab', { tabId: ids[1] })) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(mgr.getBrowserState().activeTabId).toBe(ids[2]); // right neighbor slid in
    expect(fakeWc(1).close).toHaveBeenCalled(); // destroyed
    expect(win.contentView.children).toEqual([h.views[2]]);

    await invoke('browser:close-tab', { tabId: ids[0] });
    await invoke('browser:close-tab', { tabId: ids[2] });
    const state = mgr.getBrowserState();
    expect(state.tabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
    expect(state.viewVisible).toBe(false);

    // Closing an unknown tab is a graceful {ok:false}.
    expect(await invoke('browser:close-tab', { tabId: 'ghost' })).toEqual({ ok: false });
  });

  it('pinned tabs cannot be closed until unpinned (close guard + pin round-trip)', async () => {
    const mgr = await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };

    expect(await invoke('browser:pin-tab', { tabId, pinned: true })).toEqual({ ok: true });
    expect(mgr.getBrowserState().tabs[0].pinned).toBe(true);

    // Close is refused — for the user AND for the agent path (same action).
    expect(await invoke('browser:close-tab', { tabId })).toEqual({ ok: false });
    expect(mgr.getBrowserState().tabs).toHaveLength(1);

    // The flag survives persistence (tabs.json round-trip).
    await mgr.shutdownBrowser();
    const persisted = JSON.parse(
      fs.readFileSync(path.join(h.home, 'browser', 'tabs.json'), 'utf-8'),
    ) as { tabs: Array<{ id: string; pinned?: boolean }> };
    expect(persisted.tabs[0]).toMatchObject({ id: tabId, pinned: true });

    // Unpin re-enables close.
    const mgr2 = await loadManager();
    expect(await invoke('browser:pin-tab', { tabId, pinned: false })).toEqual({ ok: true });
    expect(await invoke('browser:close-tab', { tabId })).toEqual({ ok: true });
    expect(mgr2.getBrowserState().tabs).toEqual([]);
    await mgr2.shutdownBrowser();
  });

  it('downloads are tracked into state with progress and completion', async () => {
    const mgr = await loadManager();
    const listeners: { updated: (() => void) | null; done: ((...a: unknown[]) => void) | null } = { updated: null, done: null };
    const item = {
      getFilename: () => 'report.pdf',
      getTotalBytes: () => 1000,
      getReceivedBytes: vi.fn(() => 400),
      setSavePath: vi.fn(),
      on: (ev: string, fn: () => void) => { if (ev === 'updated') listeners.updated = fn; },
      once: (ev: string, fn: (...a: unknown[]) => void) => { if (ev === 'done') listeners.done = fn; },
    };
    h.downloadHandler.fn!({}, item);

    await flush();
    let s = mgr.getBrowserState();
    expect(s.downloads).toHaveLength(1);
    expect(s.downloads![0]).toMatchObject({
      filename: 'report.pdf', state: 'progressing', receivedBytes: 400, totalBytes: 1000,
    });
    expect(item.setSavePath).toHaveBeenCalledWith(expect.stringContaining('report.pdf'));

    item.getReceivedBytes = vi.fn(() => 1000);
    listeners.updated!();
    await flush();
    listeners.done!({}, 'completed');
    await flush();
    s = mgr.getBrowserState();
    expect(s.downloads![0].state).toBe('completed');
    expect(s.downloads![0].receivedBytes).toBe(1000);
    expect((await invoke('browser:downloads-list', undefined))).toHaveLength(1);
    await mgr.shutdownBrowser();
  });

  it('reopen-closed-tab pops the stack, restores url+pin, and tracks closedCount', async () => {
    const mgr = await loadManager();
    const { tabId: a } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    const { tabId: b } = (await invoke('browser:new-tab', { url: 'https://b.com' })) as { tabId: string };
    await invoke('browser:pin-tab', { tabId: a, pinned: true });

    expect(mgr.getBrowserState().closedCount ?? 0).toBe(0);
    expect(await invoke('browser:reopen-closed-tab', undefined)).toEqual({ ok: false });

    // Close b (unpinned) then a (via unpin): stack is [b, a], newest popped first.
    await invoke('browser:close-tab', { tabId: b });
    expect(mgr.getBrowserState().closedCount).toBe(1);
    await invoke('browser:pin-tab', { tabId: a, pinned: false });
    await invoke('browser:close-tab', { tabId: a });
    expect(mgr.getBrowserState().closedCount).toBe(2);
    expect(mgr.getBrowserState().tabs).toEqual([]);

    const first = (await invoke('browser:reopen-closed-tab', undefined)) as { tabId: string };
    let state = mgr.getBrowserState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].url).toBe('https://a.com'); // newest first
    expect(state.tabs[0].pinned).toBe(false); // was unpinned when closed
    expect(state.closedCount).toBe(1);

    const second = (await invoke('browser:reopen-closed-tab', undefined)) as { tabId: string };
    state = mgr.getBrowserState();
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs.map((t) => t.url)).toContain('https://b.com');
    expect(state.closedCount).toBe(0);
    expect(await invoke('browser:reopen-closed-tab', undefined)).toEqual({ ok: false });
    await mgr.shutdownBrowser();
  });

  it('reopen at MAX_TABS keeps the closed record for later', async () => {
    const mgr = await loadManager();
    await invoke('browser:new-tab', { url: 'https://doomed.com' });
    await invoke('browser:close-tab', {}); // stack: [doomed]
    expect(mgr.getBrowserState().closedCount).toBe(1);

    for (let i = 0; i < MAX_TABS; i++) await invoke('browser:new-tab', {});
    await expect(invoke('browser:reopen-closed-tab', undefined)).rejects.toThrow('tab limit reached');
    // The record survived the failed reopen — free a slot and it reopens.
    // (The freed slot is a blank tab; blanks are never recorded.)
    expect(mgr.getBrowserState().closedCount).toBe(1);
    await invoke('browser:close-tab', { tabId: mgr.getBrowserState().tabs[0].id });
    expect(mgr.getBrowserState().closedCount).toBe(1);
    const res = (await invoke('browser:reopen-closed-tab', undefined)) as { tabId: string };
    expect(res.tabId).toBeTruthy();
    expect(mgr.getBrowserState().tabs.some((t) => t.url === 'https://doomed.com')).toBe(true);
    expect(mgr.getBrowserState().closedCount).toBe(0);
    await mgr.shutdownBrowser();
  });

  it('tab-switch shortcuts reach the app while a page has focus (before-input-event)', async () => {
    const mgr = await loadManager();
    const { tabId: a } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    const { tabId: b } = (await invoke('browser:new-tab', { url: 'https://b.com' })) as { tabId: string };
    const { tabId: c } = (await invoke('browser:new-tab', { url: 'https://c.com' })) as { tabId: string };
    // c is active (last created); before-input-event fires per tab view.
    const prevent = vi.fn();
    const ev = () => ({ preventDefault: prevent });
    const wc = fakeWc(2) as unknown as { emit: (name: string, ...args: unknown[]) => void };

    wc.emit('before-input-event', ev(), { type: 'keyDown', key: '1', meta: true });
    expect(mgr.getBrowserState().activeTabId).toBe(a);
    expect(prevent).toHaveBeenCalled();

    wc.emit('before-input-event', ev(), { type: 'keyDown', key: 'Tab', control: true });
    expect(mgr.getBrowserState().activeTabId).toBe(b);
    wc.emit('before-input-event', ev(), { type: 'keyDown', key: 'Tab', control: true, shift: true });
    expect(mgr.getBrowserState().activeTabId).toBe(a);

    wc.emit('before-input-event', ev(), { type: 'keyDown', key: '9', meta: true });
    expect(mgr.getBrowserState().activeTabId).toBe(c);

    // Non-shortcut keys pass through untouched.
    prevent.mockClear();
    wc.emit('before-input-event', ev(), { type: 'keyDown', key: 'b' });
    expect(prevent).not.toHaveBeenCalled();
    await mgr.shutdownBrowser();
  });

  it('apps: add/list/remove round-trips apps.json and openApp finds-or-creates', async () => {
    const mgr = await loadManager();

    // Add is idempotent per origin and backfills the name.
    const app = (await invoke('browser:apps-add', { origin: 'https://mail.google.com/' })) as { id: string; name: string; origin: string };
    expect(app).toMatchObject({ id: 'app-https-mail.google.com', origin: 'https://mail.google.com' });
    expect(app.name).toBeTruthy();
    const dup = (await invoke('browser:apps-add', { origin: 'https://mail.google.com' })) as { id: string };
    expect(dup.id).toBe(app.id);
    expect(await invoke('browser:apps-list', undefined)).toHaveLength(1);

    // Invalid origins are rejected without touching the file.
    const bad = (await invoke('browser:apps-add', { origin: 'not-a-url' })) as { error?: string };
    expect(bad.error).toBeTruthy();
    expect(await invoke('browser:apps-list', undefined)).toHaveLength(1);

    // First open creates a PINNED tab at the origin.
    const first = (await invoke('browser:open-app', { appId: app.id })) as { tabId: string; created: boolean };
    expect(first.created).toBe(true);
    const state = mgr.getBrowserState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].url).toBe('https://mail.google.com');
    expect(state.tabs[0].pinned).toBe(true);
    expect(state.activeTabId).toBe(first.tabId);

    // Second open ACTIVATES the same tab instead of duplicating.
    await invoke('browser:activate-tab', { tabId: (await invoke('browser:new-tab', { url: 'https://other.com' })) as { tabId: string } });
    const second = (await invoke('browser:open-app', { appId: app.id })) as { tabId: string; created: boolean };
    expect(second.created).toBe(false);
    expect(second.tabId).toBe(first.tabId);
    expect(mgr.getBrowserState().tabs).toHaveLength(2);

    // Rename updates the registry (and rejects empty names / unknown ids).
    const renamed = (await invoke('browser:apps-rename', { appId: app.id, name: 'Gmail' })) as { id: string; name: string };
    expect(renamed).toMatchObject({ id: app.id, name: 'Gmail' });
    expect(await invoke('browser:apps-rename', { appId: app.id, name: '  ' })).toMatchObject({ error: expect.any(String) });
    expect(await invoke('browser:apps-rename', { appId: 'app-ghost', name: 'X' })).toMatchObject({ error: expect.any(String) });

    // Unknown app errors cleanly; removal persists.
    expect(await invoke('browser:open-app', { appId: 'app-ghost' })).toMatchObject({ error: expect.any(String) });
    expect(await invoke('browser:apps-remove', { appId: app.id })).toEqual({ ok: true });
    expect(await invoke('browser:apps-list', undefined)).toEqual([]);
    const onDisk = JSON.parse(fs.readFileSync(path.join(h.home, 'browser', 'apps.json'), 'utf-8'));
    expect(onDisk).toEqual([]);
    await mgr.shutdownBrowser();
  });
});

describe('session hardening', () => {
  it('denies every permission request and check on the tab partition', async () => {
    await loadManager();
    expect(h.sessionPartition.value).toBe('persist:cowork-browser');
    expect(h.permissionRequestHandler.fn).toBeTypeOf('function');
    expect(h.permissionCheckHandler.fn).toBeTypeOf('function');
    const cb = vi.fn();
    h.permissionRequestHandler.fn!({}, 'media', cb);
    expect(cb).toHaveBeenCalledWith(false); // camera/mic/whatever — always denied
    expect(h.permissionCheckHandler.fn!()).toBe(false);
  });

  it('will-download saves to the Downloads folder with a deduped name', async () => {
    await loadManager();
    expect(h.downloadHandler.fn).toBeTypeOf('function');
    const downloads = `${h.home}/fake-downloads`;
    fs.mkdirSync(downloads, { recursive: true });
    fs.writeFileSync(path.join(downloads, 'report.pdf'), 'taken');

    const item = { getFilename: () => 'report.pdf', setSavePath: vi.fn() };
    h.downloadHandler.fn!({}, item);
    expect(item.setSavePath).toHaveBeenCalledWith(path.join(downloads, 'report (1).pdf'));

    const free = { getFilename: () => 'new.bin', setSavePath: vi.fn() };
    h.downloadHandler.fn!({}, free);
    expect(free.setSavePath).toHaveBeenCalledWith(path.join(downloads, 'new.bin'));
  });
});

describe('navigation', () => {
  it('navigate normalizes omnibox input and loads it', async () => {
    await loadManager();
    const { tabId } = (await invoke('browser:new-tab', {})) as { tabId: string };
    await invoke('browser:navigate', { tabId, url: 'foo bar' });
    expect(fakeWc(0).loadURL).toHaveBeenCalledWith(
      `https://www.google.com/search?q=${encodeURIComponent('foo bar')}`,
    );
    await invoke('browser:navigate', { tabId, url: 'docs.example.com/x' });
    expect(fakeWc(0).loadURL).toHaveBeenCalledWith('https://docs.example.com/x');
    // host:port is a port, not a scheme — local targets get plain http.
    await invoke('browser:navigate', { tabId, url: 'localhost:3000' });
    expect(fakeWc(0).loadURL).toHaveBeenCalledWith('http://localhost:3000');
  });

  it('navigate rejects disallowed schemes BEFORE touching the model', async () => {
    const mgr = await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    for (const bad of ['file:///etc/passwd', 'data:text/html,boom', 'javascript:alert(1)']) {
      await invoke('browser:navigate', { tabId, url: bad }); // IPC handler logs+swallows
    }
    // The tab was never patched with the rejected urls and nothing loaded them.
    expect(mgr.getBrowserState().tabs[0].url).toBe('https://a.com');
    for (const call of fakeWc(0).loadURL.mock.calls) {
      expect(call[0]).toMatch(/^https?:\/\//);
    }
  });

  it('will-navigate lets http(s)/about:blank through and blocks other schemes', async () => {
    await loadManager();
    await invoke('browser:new-tab', { url: 'https://a.com' });
    const wc = fakeWc(0);
    const prevent = vi.fn();
    wc.emit('will-navigate', { preventDefault: prevent }, 'https://fine.com');
    expect(prevent).not.toHaveBeenCalled();
    wc.emit('will-navigate', { preventDefault: prevent }, 'about:blank');
    expect(prevent).not.toHaveBeenCalled();
    wc.emit('will-navigate', { preventDefault: prevent }, 'file:///etc/passwd');
    expect(prevent).toHaveBeenCalledTimes(1);
    wc.emit('will-navigate', { preventDefault: prevent }, 'javascript:alert(1)');
    expect(prevent).toHaveBeenCalledTimes(2);
  });

  it('will-navigate hands mailto: to the OS handler (parity with window.open)', async () => {
    await loadManager();
    await invoke('browser:new-tab', { url: 'https://a.com' });
    const prevent = vi.fn();
    fakeWc(0).emit('will-navigate', { preventDefault: prevent }, 'mailto:a@b.com');
    expect(prevent).toHaveBeenCalledTimes(1);
    expect(h.externalSpy).toHaveBeenCalledWith('mailto:a@b.com');
  });

  it('window.open: http(s) becomes a new tab, mailto goes external, rest denied', async () => {
    const mgr = await loadManager();
    await invoke('browser:new-tab', { url: 'https://a.com' });
    const handler = fakeWc(0).windowOpenHandler!;

    expect(handler({ url: 'https://popup.com/x' })).toEqual({ action: 'deny' });
    expect(mgr.getBrowserState().tabs).toHaveLength(2); // new tab created
    expect(fakeWc(1).loadURL).toHaveBeenCalledWith('https://popup.com/x');

    expect(handler({ url: 'mailto:a@b.com' })).toEqual({ action: 'deny' });
    expect(h.externalSpy).toHaveBeenCalledWith('mailto:a@b.com');

    expect(handler({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
    expect(mgr.getBrowserState().tabs).toHaveLength(2);
  });

  it('synthesizes load progress 0 → 0.7 → 1 and records errors (ignoring -3)', async () => {
    const mgr = await loadManager();
    const { tabId } = (await invoke('browser:new-tab', {})) as { tabId: string };
    await invoke('browser:navigate', { tabId, url: 'https://a.com' });
    const wc = fakeWc(0);
    const tab = () => mgr.getBrowserState().tabs[0];

    wc.emit('did-start-loading');
    expect(tab()).toMatchObject({ isLoading: true, loadProgress: 0, error: null });
    wc.emit('dom-ready');
    expect(tab().loadProgress).toBe(0.7);
    wc.emit('did-navigate', {}, 'https://a.com/');
    expect(tab().loadProgress).toBe(0.7);
    wc.emit('did-stop-loading');
    expect(tab()).toMatchObject({ isLoading: false, loadProgress: 1 });

    wc.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://a.com/', true);
    expect(tab().error).toBeNull(); // benign abort
    wc.emit('did-fail-load', {}, -106, 'ERR_INTERNET_DISCONNECTED', 'https://a.com/', false);
    expect(tab().error).toBeNull(); // subframe — not a tab error
    wc.emit('did-fail-load', {}, -106, 'ERR_INTERNET_DISCONNECTED', 'https://a.com/', true);
    expect(tab().error).toEqual({ code: -106, description: 'ERR_INTERNET_DISCONNECTED' });
  });

  it('tracks title/favicon events and back/forward via navigationHistory', async () => {
    const mgr = await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    const wc = fakeWc(0) as unknown as EventEmitter & {
      navigationHistory: { canGoBack: ReturnType<typeof vi.fn>; canGoForward: ReturnType<typeof vi.fn>; goBack: ReturnType<typeof vi.fn> };
    };

    wc.emit('page-title-updated', {}, 'Page A');
    wc.emit('page-favicon-updated', {}, ['https://a.com/f.ico']);
    expect(mgr.getBrowserState().tabs[0]).toMatchObject({ title: 'Page A', favicon: 'https://a.com/f.ico' });

    // Non-http(s)/data: favicons are dropped, never stored on the tab.
    wc.emit('page-favicon-updated', {}, ['file:///etc/passwd']);
    expect(mgr.getBrowserState().tabs[0].favicon).toBeNull();
    wc.emit('page-favicon-updated', {}, ['data:image/png;base64,iVBOR']);
    expect(mgr.getBrowserState().tabs[0].favicon).toBe('data:image/png;base64,iVBOR');

    // No history yet → goBack reports { ok: true, moved: false } and stays put.
    expect(await invoke('browser:go-back', { tabId })).toEqual({ ok: true, moved: false });
    expect(wc.navigationHistory.goBack).not.toHaveBeenCalled();

    wc.navigationHistory.canGoBack.mockReturnValue(true);
    wc.emit('did-stop-loading');
    expect(mgr.getBrowserState().tabs[0].canGoBack).toBe(true);

    expect(await invoke('browser:go-back', { tabId })).toEqual({ ok: true, moved: true });
    expect(wc.navigationHistory.goBack).toHaveBeenCalled();
  });

  it('context menu offers nav items, link actions, and Inspect Element', async () => {
    await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    const wc = fakeWc(0) as unknown as EventEmitter & { inspectElement: ReturnType<typeof vi.fn>; openDevTools: ReturnType<typeof vi.fn> };
    wc.emit('context-menu', {}, { linkURL: 'https://linked.com/x', x: 5, y: 7 });

    expect(h.menus).toHaveLength(1);
    const labels = (h.menus[0] as Array<{ label?: string }>).map((i) => i.label);
    expect(labels).toEqual(['Back', 'Forward', 'Reload', undefined, 'Copy Link', 'Open in Browser', 'Inspect Element']);

    const items = h.menus[0] as Array<{ label?: string; click?: () => void }>;
    items.find((i) => i.label === 'Copy Link')!.click!();
    expect(h.clipboardSpy).toHaveBeenCalledWith('https://linked.com/x');
    items.find((i) => i.label === 'Open in Browser')!.click!();
    expect(h.externalSpy).toHaveBeenCalledWith('https://linked.com/x');
    items.find((i) => i.label === 'Inspect Element')!.click!();
    expect(wc.openDevTools).toHaveBeenCalledWith({ mode: 'detach' });
    expect(wc.inspectElement).toHaveBeenCalledWith(5, 7);
    expect(tabId).toBeTruthy();
  });
});

describe('history + persistence', () => {
  it('records redacted visits (no query strings) to history.json', async () => {
    await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    void tabId;
    const wc = fakeWc(0);
    wc.emit('did-navigate', {}, 'https://a.com/path?token=secret#frag');
    wc.emit('page-title-updated', {}, 'Title A');
    wc.emit('did-navigate', {}, 'ftp://ignored.com/x'); // non-http not recorded

    const file = path.join(h.home, 'browser', 'history.json');
    const history = JSON.parse(fs.readFileSync(file, 'utf-8')) as Array<{ url: string; title: string }>;
    expect(history).toEqual([{ url: 'https://a.com/path', title: 'Title A', ts: expect.any(Number) }]);
    expect(JSON.stringify(history)).not.toContain('secret');
  });

  it('persists tabs.json (debounced) and restores it on the next register', async () => {
    let mgr = await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    await invoke('browser:new-tab', { url: 'https://b.com', activate: false });
    await flush(550); // persist debounce

    const file = path.join(h.home, 'browser', 'tabs.json');
    const persisted = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(persisted.activeTabId).toBe(tabId);
    expect(persisted.tabs).toHaveLength(2);
    expect(persisted.tabs[0]).not.toHaveProperty('isLoading'); // runtime-only fields
    expect(persisted.tabs[0]).not.toHaveProperty('error');

    // Fresh module (new "launch"): records are restored, but NO view is
    // created eagerly — restore fires no network traffic for tabs the user
    // never opens. Views materialize lazily on first set-visible.
    const viewCountBefore = h.views.length;
    mgr = await loadManager();
    const state = mgr.getBrowserState();
    expect(state.tabs.map((t) => t.url)).toEqual(['https://a.com', 'https://b.com']);
    expect(state.activeTabId).toBe(tabId);
    expect(h.views.length - viewCountBefore).toBe(0);

    await invoke('browser:set-visible', { visible: true, bounds: { x: 0, y: 0, width: 800, height: 600 } });
    expect(h.views.length - viewCountBefore).toBe(1); // active tab materialized
    expect(fakeWc(h.views.length - 1).loadURL).toHaveBeenCalledWith('https://a.com');
  });

  it('browser dir and persisted stores are owner-only (0700 dir, 0600 files)', async () => {
    const mgr = await loadManager();
    await invoke('browser:new-tab', { url: 'https://a.com' });
    await mgr.shutdownBrowser(); // flushes tabs.json synchronously
    expect(fs.statSync(path.join(h.home, 'browser')).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(h.home, 'browser', 'tabs.json')).mode & 0o777).toBe(0o600);
  });

  it('top-sites merges cowork history with the chrome import', async () => {
    h.chromeImportSpy.mockResolvedValue({
      imported: 1,
      profiles: ['Chrome/Default'],
      sites: [{ url: 'https://chrome.com', title: 'C', visits: 9, source: 'chrome' }],
    });
    await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    const wc = fakeWc(0);
    wc.emit('did-navigate', {}, 'https://mine.com/x');
    wc.emit('did-navigate', {}, 'https://mine.com/x');

    const sites = (await invoke('browser:top-sites', { limit: 10 })) as Array<{ url: string; visits: number; source: string }>;
    expect(sites[0]).toMatchObject({ url: 'https://chrome.com', visits: 9, source: 'chrome' });
    expect(sites[1]).toMatchObject({ url: 'https://mine.com/x', visits: 2, source: 'cowork' });
    void tabId;
  });

  it('import-chrome forces a re-import and returns the summary', async () => {
    h.chromeImportSpy.mockResolvedValue({ imported: 3, profiles: ['Chrome/Default'], sites: [] });
    await loadManager();
    const result = (await invoke('browser:import-chrome')) as { imported: number; profiles: string[] };
    expect(result).toEqual({ imported: 3, profiles: ['Chrome/Default'] });
    expect(h.chromeImportSpy).toHaveBeenCalledWith(expect.stringContaining('chrome-import.json'), { force: true });
  });
});

describe('agent bridge lifecycle', () => {
  /** Minimal POST helper for the real loopback bridge. */
  function postJson(
    port: number,
    token: string,
    route: string,
    payload: unknown,
    method: 'POST' | 'GET' = 'POST',
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: route,
          method,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf-8')) });
            } catch (err) {
              reject(err);
            }
          });
        },
      );
      req.on('error', reject);
      req.end(method === 'GET' ? undefined : JSON.stringify(payload ?? {}));
    });
  }

  it('startBrowserBridge serves /state over loopback and writes the discovery file', async () => {
    const mgr = await loadManager();
    await invoke('browser:new-tab', { url: 'https://a.com' });
    const info = await mgr.startBrowserBridge();
    expect(info).not.toBeNull();
    expect(mgr.getBrowserBridge()).toEqual(info);

    const discovery = JSON.parse(
      fs.readFileSync(path.join(h.home, 'browser-bridge.json'), 'utf-8'),
    ) as { port: number; token: string; pid: number };
    expect(discovery.port).toBe(info!.port);
    expect(discovery.token).toBe(info!.token);

    const state = await new Promise<string>((resolve, reject) => {
      http
        .get(
          { host: '127.0.0.1', port: info!.port, path: '/state', headers: { Authorization: `Bearer ${info!.token}` } },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          },
        )
        .on('error', reject);
    });
    const parsed = JSON.parse(state) as { tabs: Array<{ url: string; isAgentControlled: boolean }> };
    expect(parsed.tabs).toHaveLength(1);

    await mgr.shutdownBrowser();
    expect(mgr.getBrowserBridge()).toBeNull();
    // Clean shutdown removes the discovery file (no stale port/token).
    expect(fs.existsSync(path.join(h.home, 'browser-bridge.json'))).toBe(false);
  });

  it('shutdownBrowser flushes tabs.json synchronously', async () => {
    const mgr = await loadManager();
    await invoke('browser:new-tab', { url: 'https://a.com' });
    await mgr.shutdownBrowser(); // no 500ms wait
    const file = path.join(h.home, 'browser', 'tabs.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).tabs).toHaveLength(1);
    expect(fakeWc(0).close).toHaveBeenCalled();
  });

  it('bridge /navigate rejects a blocked scheme with 400 and leaves the model clean', async () => {
    const mgr = await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    const info = await mgr.startBrowserBridge();
    const res = await postJson(info!.port, info!.token, '/navigate', { tabId, url: 'file:///etc/passwd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('url not allowed');
    expect(mgr.getBrowserState().tabs[0].url).toBe('https://a.com'); // not poisoned
    await mgr.shutdownBrowser();
  });

  it('a superseded load (ERR_ABORTED) is success, not a 500', async () => {
    const mgr = await loadManager();
    await invoke('browser:new-tab', { url: 'https://a.com' });
    const info = await mgr.startBrowserBridge();
    fakeWc(0).loadURL.mockRejectedValueOnce(new Error("ERR_ABORTED (-3) loading 'https://b.com'"));
    const res = await postJson(info!.port, info!.token, '/navigate', { url: 'https://b.com' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ url: 'https://b.com' });
    await mgr.shutdownBrowser();
  });

  it('click waits out the load-start grace window (no pre-click reads)', async () => {
    const mgr = await loadManager();
    await invoke('browser:new-tab', { url: 'https://a.com' });
    const info = await mgr.startBrowserBridge();
    const wc = fakeWc(0) as unknown as EventEmitter & {
      executeJavaScript: ReturnType<typeof vi.fn>;
    };
    wc.executeJavaScript.mockResolvedValue(true);
    // The click triggers a navigation that only hits did-start-loading a
    // beat later — the old code resolved instantly off !isLoading().
    setTimeout(() => wc.emit('did-start-loading'), 100);
    setTimeout(() => wc.emit('did-stop-loading'), 200);
    const t0 = Date.now();
    const res = await postJson(info!.port, info!.token, '/click', { index: 0 });
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(150); // waited for did-stop-loading
    await mgr.shutdownBrowser();
  });

  it('screenshot on a hidden tab is refused with a clear error', async () => {
    const mgr = await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    const info = await mgr.startBrowserBridge();
    // The tab exists and is loaded, but was never attached on screen — a
    // capturePage there would return a 0x0 PNG, so the bridge says so instead.
    const res = await postJson(info!.port, info!.token, '/screenshot', { tabId });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('needs the tab on screen');
    await mgr.shutdownBrowser();
  });

  it('screenshot on the visibly attached tab returns a png path', async () => {
    const mgr = await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    await invoke('browser:set-visible', { visible: true, bounds: { x: 0, y: 0, width: 800, height: 600 } });
    const info = await mgr.startBrowserBridge();
    const res = await postJson(info!.port, info!.token, '/screenshot', { tabId });
    expect(res.status).toBe(200);
    const shot = res.body.path as string;
    expect(shot).toContain('cowork-browser-shots');
    expect(fs.existsSync(shot)).toBe(true);
    fs.unlinkSync(shot);
    await mgr.shutdownBrowser();
  });

  it('runScript primes a hidden tab with a behind-attach before executing', async () => {
    const mgr = await loadManager();
    await invoke('browser:new-tab', { url: 'https://a.com' });
    expect(win.contentView.children).toHaveLength(0); // never made visible
    const wc = fakeWc(0) as unknown as { executeJavaScript: ReturnType<typeof vi.fn> };
    wc.executeJavaScript.mockResolvedValue(1280); // innerWidth poll primed on first tick
    const info = await mgr.startBrowserBridge();
    const res = await postJson(info!.port, info!.token, '/read', undefined, 'GET');
    expect(res.status).toBe(200);
    // The behind-attach prime ran and cleaned itself up: nothing stays attached.
    expect(win.contentView.children).toHaveLength(0);
    await mgr.shutdownBrowser();
  });

  it('click-at on a hidden tab moves the view to the input window and warms it', async () => {
    const mgr = await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    expect(h.inputWindows).toHaveLength(0);
    const info = await mgr.startBrowserBridge();
    const res = await postJson(info!.port, info!.token, '/click-at', { tabId, x: 100, y: 200 });
    expect(res.status).toBe(200);
    // The view moved onto the hidden input window (pinned at 0,0)…
    expect(h.inputWindows).toHaveLength(1);
    const iw = h.inputWindows[0] as {
      contentView: { children: unknown[] };
      showInactive: ReturnType<typeof vi.fn>;
      hide: ReturnType<typeof vi.fn>;
    };
    expect(iw.contentView.children).toEqual([h.views[0]]);
    const view = h.views[0] as { setBounds: ReturnType<typeof vi.fn> };
    expect(view.setBounds).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0, y: 0, width: expect.any(Number), height: expect.any(Number) }),
    );
    // …and the warm cycle ran once (show → hide) with the CDP click dispatched.
    expect(iw.showInactive).toHaveBeenCalledOnce();
    expect(iw.hide).toHaveBeenCalledOnce();
    const wc = fakeWc(0) as unknown as { debugger: { sendCommand: ReturnType<typeof vi.fn> } };
    const methods = wc.debugger.sendCommand.mock.calls.map((c) => c[0]);
    expect(methods).toEqual(['Input.dispatchMouseEvent', 'Input.dispatchMouseEvent']);
    await mgr.shutdownBrowser();
  });

  it('a warmed tab skips the show cycle on later input calls', async () => {
    const mgr = await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    const info = await mgr.startBrowserBridge();
    await postJson(info!.port, info!.token, '/click-at', { tabId, x: 1, y: 1 });
    await postJson(info!.port, info!.token, '/press', { tabId, key: 'enter' });
    await postJson(info!.port, info!.token, '/insert-text', { tabId, text: 'hi' });
    const iw = h.inputWindows[0] as { showInactive: ReturnType<typeof vi.fn> };
    expect(iw.showInactive).toHaveBeenCalledOnce(); // warmed once, not per call
    const wc = fakeWc(0) as unknown as { debugger: { sendCommand: ReturnType<typeof vi.fn> } };
    const methods = wc.debugger.sendCommand.mock.calls.map((c) => c[0]);
    expect(methods).toEqual([
      'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent', // click
      'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent', // press
      'Input.insertText', // insert
    ]);
    await mgr.shutdownBrowser();
  });

  it('paste dispatches the ClipboardEvent script via runScript (no input window)', async () => {
    const mgr = await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    const info = await mgr.startBrowserBridge();
    const res = await postJson(info!.port, info!.token, '/paste', { tabId, text: 'a\tb\n1\t2' });
    expect(res.status).toBe(200);
    expect(h.inputWindows).toHaveLength(0); // paste is plain JS — no input stage needed
    const wc = fakeWc(0) as unknown as { executeJavaScript: ReturnType<typeof vi.fn> };
    const scripts = wc.executeJavaScript.mock.calls.map((c) => String(c[0]));
    expect(scripts.some((s) => s.includes('ClipboardEvent') && s.includes('a\\tb'))).toBe(true);
    await mgr.shutdownBrowser();
  });

  it('input on the visibly attached tab never touches the input window', async () => {
    const mgr = await loadManager();
    const { tabId } = (await invoke('browser:new-tab', { url: 'https://a.com' })) as { tabId: string };
    await invoke('browser:set-visible', { visible: true, bounds: { x: 0, y: 0, width: 800, height: 600 } });
    const info = await mgr.startBrowserBridge();
    const res = await postJson(info!.port, info!.token, '/click-at', { tabId, x: 10, y: 10 });
    expect(res.status).toBe(200);
    expect(h.inputWindows).toHaveLength(0);
    await mgr.shutdownBrowser();
  });
});
