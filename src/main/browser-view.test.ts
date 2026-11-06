import type { BrowserWindow, Session, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { parseStepRequest } from '../shared/browser-contract';
import type { TabHooks } from './browser-sessions';
import { PAGE_WORLD_ID } from './browser-page-script';

/* A WebContentsView whose page answers the isolated-world reads the tab sends. */
const electron = vi.hoisted(() => {
  class FakeContents {
    listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    openHandler: ((details: { url: string }) => unknown) | null = null;
    attached = false;
    sent: string[] = [];
    destroyed = false;
    url = 'about:blank';
    world: unknown[] = [];
    mainFrame = { framesInSubtree: [] as unknown[] };
    navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() };
    debugger = {
      attach: () => { this.attached = true; },
      detach: () => { this.attached = false; },
      isAttached: () => this.attached,
      sendCommand: async (method: string) => {
        if (!this.attached) throw new Error('detached');
        this.sent.push(method);
        return {};
      },
    };
    on(name: string, cb: (...args: unknown[]) => void) {
      (this.listeners[name] ??= []).push(cb);
      return this;
    }
    once(name: string, cb: (...args: unknown[]) => void) {
      return this.on(name, cb);
    }
    setWindowOpenHandler(handler: (details: { url: string }) => unknown) {
      this.openHandler = handler;
    }
    loadURL = vi.fn(async (url: string) => { this.url = url; });
    getURL() { return this.url; }
    getTitle() { return 'Title'; }
    isLoading() { return false; }
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; }
    reload = vi.fn();
    executeJavaScriptInIsolatedWorld = vi.fn(async (world: number, scripts: Array<{ code: string }>) => {
      this.world.push(world);
      const code = scripts[0].code;
      if (code.includes('"kind":"viewport"')) return { width: 800, height: 600 };
      if (code.includes('"kind":"locate"')) {
        return { found: true, box: { x: 10, y: 10, width: 100, height: 20 }, shown: true, inViewport: true, secret: false, disabled: false, tag: 'button', viewport: { width: 800, height: 600 } };
      }
      if (code.includes('"kind":"focusedSecret"')) return { secret: false };
      return { url: this.url, title: 'Title', scroll: { y: 0, height: 600, viewport: 600 }, elements: [], text: '', truncated: false, frames: [], boxes: [], viewport: { width: 800, height: 600 } };
    });
  }
  class WebContentsView {
    webContents: FakeContents;
    visible = true;
    bounds: unknown = null;
    options: unknown;
    constructor(options: { webContents?: FakeContents } = {}) {
      this.options = options;
      this.webContents = options.webContents ?? new FakeContents();
    }
    setVisible(visible: boolean) { this.visible = visible; }
    setBounds(bounds: unknown) { this.bounds = bounds; }
  }
  return { WebContentsView, FakeContents, nativeImage: { createFromBitmap: vi.fn() } };
});

vi.mock('electron', () => ({ WebContentsView: electron.WebContentsView, nativeImage: electron.nativeImage }));

const { ElectronTab } = await import('./browser-view');

type Contents = InstanceType<typeof electron.FakeContents>;

function setup(popupAllowed = false) {
  const window = { contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } };
  const hooks: TabHooks = {
    changed: vi.fn(),
    personInput: vi.fn(),
    popupAllowed: vi.fn(() => popupAllowed),
    adopt: vi.fn(),
    login: vi.fn(),
    download: vi.fn(),
    personHolds: vi.fn(() => false),
    sessionId: vi.fn(() => 't-a'),
  };
  const ctx = { window: () => window as unknown as BrowserWindow, session: () => ({}) as Session, register: vi.fn() };
  const tab = new ElectronTab(ctx, hooks, 'https://a.test/');
  const view = window.contentView.addChildView.mock.calls[0][0] as InstanceType<typeof electron.WebContentsView>;
  return { tab, hooks, window, view, contents: view.webContents as Contents, ctx };
}

describe('ElectronTab', () => {
  it("refuses to load MindsHub's own hosts or a metadata address for the agent", async () => {
    const { tab, contents } = setup();
    const before = (contents.loadURL as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await expect(tab.load('https://console.mindshub.ai/')).rejects.toMatchObject({ code: 'bad_request', message: "MindsDB's sign-in and app hosts are blocked in this browser" });
    await expect(tab.load('http://169.254.169.254/')).rejects.toMatchObject({ code: 'bad_request' });
    expect((contents.loadURL as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(before);
  });

  it('builds a locked-down view in the window and loads the page', () => {
    const { view, contents, ctx } = setup();
    expect((view.options as { webPreferences: Record<string, unknown> }).webPreferences).toMatchObject({ sandbox: true, devTools: false, contextIsolation: true });
    expect(contents.loadURL).toHaveBeenCalledWith('https://a.test/');
    expect(ctx.register).toHaveBeenCalledWith(contents, expect.anything());
    expect(Object.keys(contents.listeners)).toEqual(expect.arrayContaining(['will-navigate', 'will-redirect', 'login', 'before-input-event']));
  });

  it('refuses a popup without recent input, and makes a tab of one that follows input', () => {
    const quiet = setup(false);
    expect(quiet.contents.openHandler!({ url: 'https://pop.test/' })).toEqual({ action: 'deny' });
    const busy = setup(true);
    expect(busy.contents.openHandler!({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
    const allowed = busy.contents.openHandler!({ url: 'https://pop.test/' }) as { action: string; createWindow: (o: unknown) => WebContents };
    expect(allowed.action).toBe('allow');
    const guest = new electron.FakeContents();
    expect(allowed.createWindow({ webContents: guest })).toBe(guest);
    expect(busy.hooks.adopt).toHaveBeenCalledTimes(1);
    expect(guest.loadURL).not.toHaveBeenCalled();
  });

  it('reads the page in its own isolated world, never the page\'s', async () => {
    const { tab, contents } = setup();
    const page = await tab.read(100);
    expect(page).toMatchObject({ url: 'https://a.test/', challenges: [] });
    expect(page).not.toHaveProperty('boxes');
    expect(contents.world).toEqual([PAGE_WORLD_ID]);
  });

  it('attaches the debugger for one step and detaches after it', async () => {
    const { tab, contents } = setup();
    const parsed = parseStepRequest({ action: 'click', element: 1 });
    if (!parsed.ok) throw new Error(parsed.message);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await tab.act(parsed.value);
    } finally {
      vi.useRealTimers();
    }
    expect(contents.attached).toBe(false);
    expect(contents.sent).toContain('Input.dispatchMouseEvent');
  });

  it('detaches the debugger at once when the person takes over', async () => {
    const { tab, contents } = setup();
    contents.debugger.attach();
    tab.abortInput();
    expect(contents.attached).toBe(false);
  });

  it('answers a sign-in prompt only through the person', () => {
    const { contents, hooks } = setup();
    const callback = vi.fn();
    const event = { preventDefault: vi.fn() };
    contents.listeners.login[0](event, {}, { host: 'intranet.test' }, callback);
    expect(event.preventDefault).toHaveBeenCalled();
    const request = (hooks.login as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.host).toBe('intranet.test');
    request.respond({ username: 'ada', password: 'pw' });
    expect(callback).toHaveBeenCalledWith('ada', 'pw');
  });

  it('shows on top at the stage, parks laid out but off screen, and closes for good', () => {
    const { tab, view, window, contents } = setup();
    tab.show({ x: 1, y: 2, width: 3, height: 4 });
    expect(view.visible).toBe(true);
    expect(view.bounds).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(window.contentView.addChildView).toHaveBeenLastCalledWith(view);
    tab.park({ x: 400, y: 56, width: 800, height: 700 });
    // Still visible, so Chromium keeps laying it out, with one pixel in the window's corner.
    expect(view.visible).toBe(true);
    expect(view.bounds).toEqual({ x: -799, y: -699, width: 800, height: 700 });
    tab.close();
    expect(window.contentView.removeChildView).toHaveBeenCalledWith(view);
    expect(contents.destroyed).toBe(true);
    tab.show({ x: 1, y: 2, width: 3, height: 4 });
    expect(view.bounds).toEqual({ x: -799, y: -699, width: 800, height: 700 });
  });
});
