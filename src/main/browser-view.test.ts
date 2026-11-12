import type { BrowserWindow, Session, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { ANTON_REQUEST_TIMEOUT_MS, parseStepRequest, SETTLE_MAX_MS, SETTLE_QUIET_MS, STEP_TIMEOUT_MS, type StepOutcome, type StepRequest } from '../shared/browser-contract';
import type { TabHooks } from './browser-sessions';
import { PAGE_READ_TIMEOUT_MS, PAGE_WORLD_ID, SECRET_SEARCH_DEPTH } from './browser-page-script';

/* A WebContentsView whose page answers the isolated-world reads the tab
   sends, and whose debugger answers the reads a step makes through it
   (tests/browser-fake-cdp.ts). */
const electron = await vi.hoisted(async () => {
  const { fakeCdpDebugger } = await import('../../tests/browser-fake-cdp');
  let nextId = 1;
  class FakeContents {
    id = nextId++;
    listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    openHandler: ((details: { url: string }) => unknown) | null = null;
    destroyed = false;
    url = 'about:blank';
    world: unknown[] = [];
    loadingMainFrame = false;
    /* The page's side of the step's change watch: the token it runs under,
       what it counted, and when content last changed. */
    change = { token: null as number | null, changes: 0, lastChangeAt: 0, busy: false, opaque: false };
    mainFrame = { origin: 'https://a.test', framesInSubtree: [] as unknown[], frames: [] as unknown[] };
    focus = { secret: false, otherSite: false };
    /* What the page's secret-field read finds for a screenshot. */
    secrets = { secrets: [] as unknown[], paymentFrames: [] as unknown[], otherSiteFrames: [] as unknown[], owners: 0, viewport: { width: 800, height: 600 } };
    capturePage = vi.fn(async () => {
      const image = {
        getSize: () => ({ width: 800, height: 600 }),
        resize: () => image,
        toBitmap: () => Buffer.alloc(800 * 600 * 4, 0x80),
        toJPEG: () => Buffer.from('plain'),
      };
      return image;
    });
    navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() };
    debugger = fakeCdpDebugger();
    get attached() { return this.debugger.isAttached(); }
    get attaches() { return this.debugger.attaches; }
    /* The methods the debugger was sent, in order. */
    get sent() { return this.debugger.sent.map(([method]) => method); }
    on(name: string, cb: (...args: unknown[]) => void) {
      (this.listeners[name] ??= []).push(cb);
      return this;
    }
    once(name: string, cb: (...args: unknown[]) => void) {
      return this.on(name, cb);
    }
    removeListener(name: string, cb: (...args: unknown[]) => void) {
      this.listeners[name] = (this.listeners[name] ?? []).filter((listener) => listener !== cb);
      return this;
    }
    setWindowOpenHandler(handler: (details: { url: string }) => unknown) {
      this.openHandler = handler;
    }
    loadURL = vi.fn(async (url: string) => { this.url = url; });
    getURL() { return this.url; }
    getTitle() { return 'Title'; }
    isLoading() { return this.loadingMainFrame; }
    isLoadingMainFrame() { return this.loadingMainFrame; }
    /* The page changes: the watch counts it, and its quiet clock starts again. */
    pageChanges(count = 1) {
      this.change.changes += count;
      this.change.lastChangeAt = Date.now();
    }
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; }
    reload = vi.fn();
    reloadIgnoringCache = vi.fn();
    executeJavaScriptInIsolatedWorld = vi.fn(async (world: number, scripts: Array<{ code: string }>) => {
      this.world.push(world);
      const code = scripts[0].code;
      if (code.includes('"kind":"viewport"')) return { width: 800, height: 600 };
      if (code.includes('"kind":"locate"')) {
        return { found: true, box: { x: 10, y: 10, width: 100, height: 20 }, shown: true, inViewport: true, secret: false, disabled: false, tag: 'button', viewport: { width: 800, height: 600 } };
      }
      if (code.includes('"kind":"focusedSecret"')) return this.focus;
      if (code.includes('"kind":"secretBoxes"')) return this.secrets;
      if (code.includes('"kind":"hitTest"')) return { found: true, reaches: 0, throughFrame: -1 };
      if (code.includes('"kind":"watch"')) return { ok: true };
      const token = Number(/"token":(\d+)/.exec(code)?.[1]);
      if (code.includes('"kind":"changeStart"')) {
        this.change = { ...this.change, token, changes: 0, lastChangeAt: Date.now() };
        return { ok: true };
      }
      if (code.includes('"kind":"changeMark"')) {
        if (this.change.token !== token) return null;
        const { changes, busy, opaque, lastChangeAt } = this.change;
        return { changes, sinceLastMs: Date.now() - lastChangeAt, busy, opaque };
      }
      if (code.includes('"kind":"changeStop"')) {
        if (this.change.token === token) this.change.token = null;
        return { ok: true };
      }
      return { url: this.url, title: 'Title', scroll: { y: 0, height: 600, viewport: 600 }, elements: [], text: '', truncated: false, frameOwners: [], frames: [], boxes: [], viewport: { width: 800, height: 600 } };
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

const diagnostics = vi.hoisted(() => ({ diagnostic: vi.fn() }));
vi.mock('../shared/diagnostics', () => diagnostics);

const { ElectronTab, NAVIGATION_WAIT_MS } = await import('./browser-view');
const { requestsInFlight } = await import('./browser-profile');

type Contents = InstanceType<typeof electron.FakeContents>;

function stepOf(body: Record<string, unknown>): StepRequest {
  const parsed = parseStepRequest(body);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

/* The tab's isolated-world requests of one kind. */
const worldCalls = (contents: Contents, kind: string) =>
  contents.executeJavaScriptInIsolatedWorld.mock.calls.filter(([, scripts]) => scripts[0].code.includes(`"kind":"${kind}"`));

function onPlatform(platform: NodeJS.Platform, run: () => void): void {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    run();
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  }
}

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
  const profile = {} as Session;
  const ctx = { window: () => window as unknown as BrowserWindow, session: () => profile, register: vi.fn() };
  const tab = new ElectronTab(ctx, hooks, 'https://a.test/');
  const view = window.contentView.addChildView.mock.calls[0][0] as InstanceType<typeof electron.WebContentsView>;
  return { tab, hooks, window, view, contents: view.webContents as Contents, ctx, requests: requestsInFlight(profile) };
}

/* A request the page's main frame sends, as the profile's listeners report it. */
const mainFrameRequest = (contents: Contents, id: number) =>
  ({ id, url: `https://a.test/r/${id}`, webContentsId: contents.id, resourceType: 'xhr' as const, frame: { parent: null } });

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
    const allowed = busy.contents.openHandler!({ url: 'https://pop.test/' }) as {
      action: string;
      overrideBrowserWindowOptions: { webPreferences: Record<string, unknown> };
      createWindow: (o: unknown) => WebContents;
    };
    expect(allowed.action).toBe('allow');
    // Electron builds the popup's page from these; the view it is wrapped in ignores its own.
    const popupPreferences = allowed.overrideBrowserWindowOptions.webPreferences;
    expect(popupPreferences).toMatchObject({ sandbox: true, contextIsolation: true, devTools: false, safeDialogs: true, backgroundThrottling: false, spellcheck: false });
    expect(popupPreferences).not.toHaveProperty('session');
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

  it('reports a check frame from the frame tree without running script in it', async () => {
    const { tab, contents } = setup();
    const frame = { url: 'https://challenges.cloudflare.com/cdn-cgi/x', executeJavaScript: vi.fn() };
    contents.mainFrame.framesInSubtree = [contents.mainFrame, frame];
    const page = await tab.read(100);
    expect(page.challenges).toEqual([{ host: 'challenges.cloudflare.com', kind: 'cloudflare' }]);
    expect(frame.executeJavaScript).not.toHaveBeenCalled();
  });

  it("reads frames by the contract's rules, and lists a frame the page's DOM can't place, unread and with no box", async () => {
    const { tab, contents } = setup();
    contents.mainFrame.frames = [{ url: 'https://js.stripe.com/v3/elements-inner-card' }];
    const page = await tab.read(100);
    expect(page.frames).toEqual([{ url: 'https://js.stripe.com/v3/elements-inner-card', read: false, box: null }]);
    const [snapshot] = worldCalls(contents, 'snapshot');
    expect(snapshot[1][0].code).toContain('"paymentHosts":["stripe.com",');
    expect(snapshot[1][0].code).toContain('"read":5');
  });

  it('blacks out secret fields and payment frames in every screenshot it takes', async () => {
    const { tab, contents } = setup();
    contents.secrets = { ...contents.secrets, secrets: [{ x: 10, y: 10, width: 100, height: 20 }] };
    let drawn: Buffer | null = null;
    electron.nativeImage.createFromBitmap.mockImplementation((data: Buffer) => {
      drawn = data;
      return { toJPEG: () => Buffer.from('masked') };
    });
    const shot = await tab.screenshot(false, 70);
    expect(shot.jpeg).toEqual(Buffer.from('masked'));
    const at = (x: number, y: number) => [...drawn!.subarray((y * 800 + x) * 4, (y * 800 + x) * 4 + 4)];
    expect(at(50, 15)).toEqual([0, 0, 0, 0xff]);
    expect(at(50, 40)).toEqual([0x80, 0x80, 0x80, 0x80]);
    const [found] = worldCalls(contents, 'secretBoxes');
    expect(found[1][0].code).toContain('"paymentHosts":["stripe.com",');
  });

  it("takes no screenshot when the page holds a payment frame its DOM can't place, at the top or in a same-origin frame, and nothing is captured", async () => {
    const { tab, contents } = setup();
    const stripe = { url: 'https://js.stripe.com/v3/elements-inner-card', origin: 'https://js.stripe.com', frames: [] };
    // At the top, in a closed shadow root: the frame tree holds it, the page's search finds no owner.
    contents.mainFrame.frames = [stripe];
    contents.mainFrame.framesInSubtree = [contents.mainFrame, stripe];
    contents.secrets = { ...contents.secrets, owners: 0 };
    await expect(tab.screenshot(false, 70)).rejects.toMatchObject({ code: 'internal', status: 500, message: expect.stringContaining('payment frame') });
    // In a closed shadow root inside a same-origin frame: the search finds that frame's owner only.
    const checkout = { url: 'https://a.test/checkout', origin: 'https://a.test', frames: [stripe] };
    contents.mainFrame.frames = [checkout];
    contents.mainFrame.framesInSubtree = [contents.mainFrame, checkout, stripe];
    contents.secrets = { ...contents.secrets, owners: 1 };
    await expect(tab.screenshot(false, 70)).rejects.toMatchObject({ code: 'internal' });
    expect(contents.capturePage).not.toHaveBeenCalled();
    // Found where the tree says, it is blacked out and the screenshot is taken.
    contents.secrets = { ...contents.secrets, owners: 2, paymentFrames: [{ x: 0, y: 100, width: 300, height: 40 }] };
    electron.nativeImage.createFromBitmap.mockImplementation(() => ({ toJPEG: () => Buffer.from('masked') }));
    await expect(tab.screenshot(false, 70)).resolves.toMatchObject({ jpeg: Buffer.from('masked') });
    const [, request] = worldCalls(contents, 'secretBoxes').at(-1)!;
    expect(request[0].code).toContain(`"depth":${SECRET_SEARCH_DEPTH}`);
  });

  it("refuses a key that edits text into a secret field of another site's frame, read through the debugger, and types into an ordinary one there", async () => {
    const { tab, contents } = setup();
    // The page's world sees the focus rest on a frame it can't read.
    contents.focus = { secret: false, otherSite: true };
    const frame = { id: 'widget', url: 'https://login.other.test/embed', parentId: 'main', remote: true, focus: { secret: true, otherSite: false } };
    contents.debugger.page.frames.push(frame);
    contents.debugger.page.focusedOwnerOf = 'widget';
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await expect(tab.act(stepOf({ action: 'press', key: 'a' }))).rejects.toMatchObject({ code: 'password_field', status: 403 });
      await expect(tab.act(stepOf({ action: 'press', key: 'Enter' }))).resolves.toBeDefined();
      frame.focus = { secret: false, otherSite: false };
      await expect(tab.act(stepOf({ action: 'press', key: 'a' }))).resolves.toBeDefined();
    } finally {
      vi.useRealTimers();
    }
    expect(contents.attached).toBe(false);
  });

  it('starts the secret-field watch as each document loads, and when asked', () => {
    const { tab, contents } = setup();
    contents.listeners['dom-ready'][0]();
    contents.listeners['did-frame-navigate'][0]({}, 'https://a.test/next', 200, 'OK', true);
    contents.listeners['did-frame-navigate'][0]({}, 'https://ads.test/', 200, 'OK', false);
    tab.watchSecrets();
    expect(worldCalls(contents, 'watch')).toHaveLength(3);
    expect(contents.world.every((world) => world === PAGE_WORLD_ID)).toBe(true);
  });

  it('starts the watch once a slow page stops loading, past a read\'s time limit, and reports no failure', async () => {
    const { contents } = setup();
    // Electron holds isolated-world script until the page stops loading.
    contents.executeJavaScriptInIsolatedWorld.mockImplementationOnce(() => new Promise((resolve) => {
      contents.once('did-stop-loading', () => resolve({ ok: true }));
    }));
    diagnostics.diagnostic.mockClear();
    vi.useFakeTimers();
    try {
      contents.listeners['dom-ready'][0]();
      // A slow image keeps the page loading past a read's time limit.
      await vi.advanceTimersByTimeAsync(PAGE_READ_TIMEOUT_MS + 5_000);
      for (const listener of contents.listeners['did-stop-loading']) listener();
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
    expect(worldCalls(contents, 'watch')).toHaveLength(1);
    expect(diagnostics.diagnostic).not.toHaveBeenCalled();
  });

  it('never throws when the watch cannot start', async () => {
    const { tab, contents } = setup();
    contents.executeJavaScriptInIsolatedWorld.mockRejectedValueOnce(new Error('the frame went away'));
    expect(() => tab.watchSecrets()).not.toThrow();
    contents.executeJavaScriptInIsolatedWorld.mockImplementationOnce(() => {
      throw new Error('Object has been destroyed');
    });
    expect(() => tab.watchSecrets()).not.toThrow();
    // A closed tab doesn't ask its page at all.
    tab.close();
    tab.watchSecrets();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worldCalls(contents, 'watch')).toHaveLength(2);
  });

  it('attaches the debugger for one step and detaches after it', async () => {
    const { tab, contents } = setup();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await tab.act(stepOf({ action: 'click', element: 1 }));
    } finally {
      vi.useRealTimers();
    }
    expect(contents.attached).toBe(false);
    expect(contents.sent).toContain('Input.dispatchMouseEvent');
  });

  it("tells a click's hit test how many child frames the frame tree gives the page", async () => {
    const { tab, contents } = setup();
    contents.mainFrame.frames = [{ url: 'https://ads.example.test/' }, { url: 'https://shop.other.test/buy' }];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await tab.act(stepOf({ action: 'click', element: 1 }));
      await tab.act(stepOf({ action: 'click', x: 10, y: 10, coords: 'page' }));
    } finally {
      vi.useRealTimers();
    }
    expect(worldCalls(contents, 'hitTest').length).toBeGreaterThan(0);
    expect(worldCalls(contents, 'hitTest').every(([, scripts]) => scripts[0].code.includes('"childFrames":2'))).toBe(true);
  });

  it('detaches the debugger at once when the person takes over', async () => {
    const { tab, contents } = setup();
    contents.debugger.attach();
    tab.abortInput();
    expect(contents.attached).toBe(false);
  });

  it('ends a wait at once when the person takes over, though no debugger is attached', async () => {
    const { tab } = setup();
    vi.useFakeTimers();
    try {
      const running = tab.act(stepOf({ action: 'wait', ms: 30_000 }));
      tab.abortInput();
      await expect(running).rejects.toMatchObject({ code: 'human_in_control' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends a navigation still loading when the person takes over', async () => {
    const { tab, contents } = setup();
    contents.loadURL.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    try {
      const running = tab.act(stepOf({ action: 'navigate', url: 'https://intranet.test/' }));
      // A sign-in prompt hands the browser to the person mid-load.
      tab.abortInput();
      await expect(running).rejects.toMatchObject({ code: 'human_in_control' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('never attaches when the person takes over while a first step reads the viewport', async () => {
    const { tab, contents } = setup();
    let answer: (viewport: { width: number; height: number }) => void = () => {};
    const page = contents.executeJavaScriptInIsolatedWorld.getMockImplementation()!;
    contents.executeJavaScriptInIsolatedWorld.mockImplementation((world, scripts) => (scripts[0].code.includes('"kind":"viewport"')
      ? new Promise<{ width: number; height: number }>((resolve) => { answer = resolve; })
      : page(world, scripts)));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const running = tab.act(stepOf({ action: 'click', element: 1 }));
      tab.abortInput();
      answer({ width: 800, height: 600 });
      await expect(running).rejects.toMatchObject({ code: 'human_in_control' });
    } finally {
      vi.useRealTimers();
    }
    expect(contents.attaches).toBe(0);
    expect(contents.sent).toEqual([]);
  });

  it('ends a first step at once when the person takes over while the page has not answered its viewport read', async () => {
    const { tab, contents } = setup();
    const page = contents.executeJavaScriptInIsolatedWorld.getMockImplementation()!;
    contents.executeJavaScriptInIsolatedWorld.mockImplementation((world, scripts) => (scripts[0].code.includes('"kind":"viewport"') ? new Promise(() => {}) : page(world, scripts)));
    vi.useFakeTimers();
    try {
      const running = tab.act(stepOf({ action: 'click', element: 1 }));
      let outcome: unknown = 'still waiting';
      running.catch((error: unknown) => { outcome = error; });
      tab.abortInput();
      // No time passes: the read's own time limit plays no part.
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome).toMatchObject({ code: 'human_in_control' });
    } finally {
      vi.useRealTimers();
    }
    expect(contents.attaches).toBe(0);
  });

  it("ends a step the page blocks with page_blocked while anton's client still waits, with room for an included page read", async () => {
    const { tab, contents } = setup();
    // A dialog holds the page, so a key the agent sends never lands.
    const send = contents.debugger.sendCommand;
    vi.spyOn(contents.debugger, 'sendCommand').mockImplementation((method: string) => (method.startsWith('Input.') ? new Promise<object>(() => {}) : send(method)));
    vi.useFakeTimers();
    try {
      let outcome: unknown = 'still waiting';
      tab.act(stepOf({ action: 'press', key: 'Escape' })).catch((error: unknown) => { outcome = error; });
      await vi.advanceTimersByTimeAsync(ANTON_REQUEST_TIMEOUT_MS - PAGE_READ_TIMEOUT_MS - 1);
      expect(outcome).toMatchObject({ code: 'page_blocked', status: 409 });
    } finally {
      vi.useRealTimers();
    }
    expect(contents.attached).toBe(false);
  });

  it('answers a navigation still loading once its wait and its settle run out, before the step budget calls the page blocked', async () => {
    const { tab, contents } = setup();
    contents.loadURL.mockImplementationOnce(() => new Promise(() => {}));
    contents.loadingMainFrame = true;
    vi.useFakeTimers();
    try {
      let outcome: unknown = 'still waiting';
      tab.act(stepOf({ action: 'navigate', url: 'https://slow.test/' })).then(() => { outcome = 'answered'; }, (error: unknown) => { outcome = error; });
      await vi.advanceTimersByTimeAsync(NAVIGATION_WAIT_MS);
      expect(outcome).toBe('still waiting');
      await vi.advanceTimersByTimeAsync(STEP_TIMEOUT_MS - NAVIGATION_WAIT_MS - 1);
      expect(outcome).toBe('answered');
    } finally {
      vi.useRealTimers();
    }
  });

  it('names the host when the profile refuses an address', async () => {
    const { tab, contents } = setup();
    contents.loadURL.mockRejectedValueOnce(Object.assign(new Error('blocked'), { code: 'ERR_BLOCKED_BY_CLIENT' }));
    await expect(tab.load('http://127.0.0.1:5000/x')).rejects.toMatchObject({ code: 'bad_request', message: 'navigation to 127.0.0.1:5000 is blocked in this browser' });
  });

  it('names the refused host, not the one asked for, when an allowed address redirects to it', async () => {
    const { tab, contents } = setup();
    contents.loadURL.mockRejectedValueOnce(Object.assign(new Error('blocked'), { code: 'ERR_BLOCKED_BY_CLIENT', url: 'http://127.0.0.1:5000/' }));
    await expect(tab.load('https://a.example/r')).rejects.toMatchObject({ code: 'bad_request', message: 'navigation to 127.0.0.1:5000 is blocked in this browser' });
    contents.loadURL.mockRejectedValueOnce(Object.assign(new Error('blocked'), { code: 'ERR_BLOCKED_BY_CLIENT', url: 'not an address' }));
    await expect(tab.load('https://a.example/r')).rejects.toMatchObject({ message: 'navigation to a.example is blocked in this browser' });
  });

  it('answers a site that asks for a client certificate with none', () => {
    const { contents } = setup();
    const event = { preventDefault: vi.fn() };
    const callback = vi.fn();
    contents.listeners['select-client-certificate'][0](event, 'https://mtls.test/', [{ subjectName: 'Ada' }], callback);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith();
  });

  it.each([['win32', true], ['linux', true], ['darwin', false]] as const)("keeps the person's Control+W in the pane on %s: %s", (platform, kept) => {
    onPlatform(platform, () => {
      const { contents, hooks } = setup();
      const input = contents.listeners['before-input-event'][0];
      const closeKey = { preventDefault: vi.fn() };
      input(closeKey, { type: 'keyDown', key: 'w', code: 'KeyW', control: true, alt: false });
      expect(closeKey.preventDefault).toHaveBeenCalledTimes(kept ? 1 : 0);
      const copyKey = { preventDefault: vi.fn() };
      input(copyKey, { type: 'keyDown', key: 'c', code: 'KeyC', control: true, alt: false });
      expect(copyKey.preventDefault).not.toHaveBeenCalled();
      expect(hooks.personInput).toHaveBeenCalledTimes(2);
      expect(contents.reload).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['win32', 'control', 'meta'],
    ['linux', 'control', 'meta'],
    ['darwin', 'meta', 'control'],
  ] as const)("reloads the site, not the app, on the person's reload chord on %s (%s+R)", (platform, modifier, other) => {
    onPlatform(platform, () => {
      const { contents } = setup();
      const input = contents.listeners['before-input-event'][0];
      const press = (key: Record<string, unknown>) => {
        const event = { preventDefault: vi.fn() };
        input(event, { type: 'keyDown', control: false, meta: false, shift: false, alt: false, ...key });
        return event.preventDefault.mock.calls.length;
      };
      expect(press({ key: 'r', code: 'KeyR', [modifier]: true })).toBe(1);
      expect([contents.reload.mock.calls.length, contents.reloadIgnoringCache.mock.calls.length]).toEqual([1, 0]);
      expect(press({ key: 'R', code: 'KeyR', [modifier]: true, shift: true })).toBe(1);
      expect([contents.reload.mock.calls.length, contents.reloadIgnoringCache.mock.calls.length]).toEqual([1, 1]);
      // The R key on a Cyrillic layout, which the menu matches by its position.
      expect(press({ key: 'к', code: 'KeyR', [modifier]: true })).toBe(1);
      expect(contents.reload).toHaveBeenCalledTimes(2);
      // The page keeps the other modifier's R, the chord with Alt, the key's release, and R on another layout's key.
      expect(press({ key: 'r', code: 'KeyR', [other]: true })).toBe(0);
      expect(press({ key: 'r', code: 'KeyR', [modifier]: true, alt: true })).toBe(0);
      expect(press({ type: 'keyUp', key: 'r', code: 'KeyR', [modifier]: true })).toBe(0);
      expect(press({ key: 'k', code: 'KeyR', [modifier]: true })).toBe(0);
      expect([contents.reload.mock.calls.length, contents.reloadIgnoringCache.mock.calls.length]).toEqual([2, 1]);
    });
  });

  it.each([
    ['the W key on a Cyrillic layout', { key: 'ц', code: 'KeyW' }, true],
    ['the W key on a Hebrew layout', { key: "'", code: 'KeyW' }, true],
    ['w on AZERTY, which sits on the Z key', { key: 'w', code: 'KeyZ' }, true],
    ['z on AZERTY, which sits on the W key', { key: 'z', code: 'KeyW' }, false],
  ] as const)("keeps Control+W in the pane by what the menu matches: %s", (_layout, key, kept) => {
    onPlatform('linux', () => {
      const { contents } = setup();
      const event = { preventDefault: vi.fn() };
      contents.listeners['before-input-event'][0](event, { type: 'keyDown', control: true, alt: false, ...key });
      expect(event.preventDefault).toHaveBeenCalledTimes(kept ? 1 : 0);
    });
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

  describe('a step settles before it answers', () => {
    /* Runs a step on a faked clock: what it answered, and how long after it
       began. */
    function timed(tab: InstanceType<typeof ElectronTab>, body: Record<string, unknown>) {
      const started = Date.now();
      const result: { outcome: StepOutcome | Error | null; at: number } = { outcome: null, at: -1 };
      tab.act(stepOf(body)).then((outcome) => { result.outcome = outcome; result.at = Date.now() - started; }, (error: Error) => { result.outcome = error; });
      return result;
    }
    /* Runs `onKey` as the step's first key reaches the page. */
    function onFirstKey(contents: Contents, onKey: () => void | Promise<void>) {
      const send = contents.debugger.sendCommand;
      let first = true;
      vi.spyOn(contents.debugger, 'sendCommand').mockImplementation(async (method: string) => {
        if (method === 'Input.dispatchKeyEvent' && first) {
          first = false;
          await onKey();
        }
        return send(method);
      });
    }

    it('answers at once a step that changed nothing and started no request; one that changed the page in place waits for it to go quiet', async () => {
      const { tab, contents } = setup();
      vi.useFakeTimers();
      try {
        const still = timed(tab, { action: 'press', key: 'Enter' });
        await vi.advanceTimersByTimeAsync(400);
        expect(still.outcome).toEqual({ changed: false });
        expect(worldCalls(contents, 'changeMark')).toHaveLength(1);
        onFirstKey(contents, () => contents.pageChanges(2));
        const changing = timed(tab, { action: 'press', key: 'Enter' });
        await vi.advanceTimersByTimeAsync(SETTLE_QUIET_MS - 50);
        expect(changing.outcome).toBeNull();
        await vi.advanceTimersByTimeAsync(400);
        expect(changing.outcome).toEqual({ changed: true });
        expect(changing.at).toBeGreaterThanOrEqual(SETTLE_QUIET_MS);
      } finally {
        vi.useRealTimers();
      }
      // Each step's watch starts before its input and stops after its settle.
      expect(worldCalls(contents, 'changeStart')).toHaveLength(2);
      expect(worldCalls(contents, 'changeStop')).toHaveLength(2);
      expect(contents.world.every((world) => world === PAGE_WORLD_ID)).toBe(true);
    });

    it('waits for a request the step started, then for the page to stay quiet, and answers with what it brought', async () => {
      const { tab, contents, requests } = setup();
      onFirstKey(contents, () => requests.sent(mainFrameRequest(contents, 41)));
      vi.useFakeTimers();
      try {
        const step = timed(tab, { action: 'press', key: 'Enter' });
        setTimeout(() => {
          requests.ended(mainFrameRequest(contents, 41));
          contents.pageChanges();
        }, 2_500);
        await vi.advanceTimersByTimeAsync(2_500 + SETTLE_QUIET_MS - 50);
        expect(step.outcome).toBeNull();
        await vi.advanceTimersByTimeAsync(300);
        expect(step.outcome).toEqual({ changed: true });
        expect(step.at).toBeGreaterThanOrEqual(2_500 + SETTLE_QUIET_MS);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps waiting after a step changed the page in place, for a request the page starts a moment later', async () => {
      const { tab, contents, requests } = setup();
      onFirstKey(contents, () => {
        // A spinner first, then the fetch behind it.
        contents.pageChanges();
        setTimeout(() => requests.sent(mainFrameRequest(contents, 45)), 250);
        setTimeout(() => {
          requests.ended(mainFrameRequest(contents, 45));
          contents.pageChanges();
        }, 2_000);
      });
      vi.useFakeTimers();
      try {
        const step = timed(tab, { action: 'press', key: 'Enter' });
        await vi.advanceTimersByTimeAsync(2_000 + SETTLE_QUIET_MS - 100);
        expect(step.outcome).toBeNull();
        await vi.advanceTimersByTimeAsync(400);
        expect(step.outcome).toEqual({ changed: true });
        expect(step.at).toBeGreaterThanOrEqual(2_000 + SETTLE_QUIET_MS);
      } finally {
        vi.useRealTimers();
      }
    });

    it("counts the quiet from the page's last change, so a page that keeps changing after its request ends settles at SETTLE_MAX_MS", async () => {
      const { tab, contents, requests } = setup();
      let ticking: NodeJS.Timeout | undefined;
      onFirstKey(contents, () => {
        requests.sent(mainFrameRequest(contents, 46));
        setTimeout(() => requests.ended(mainFrameRequest(contents, 46)), 100);
        ticking = setInterval(() => contents.pageChanges(), 100);
      });
      vi.useFakeTimers();
      try {
        const step = timed(tab, { action: 'press', key: 'Enter' });
        await vi.advanceTimersByTimeAsync(SETTLE_MAX_MS - 200);
        expect(step.outcome).toBeNull();
        await vi.advanceTimersByTimeAsync(600);
        expect(step.outcome).toEqual({ changed: true });
        expect(step.at).toBeGreaterThanOrEqual(SETTLE_MAX_MS);
      } finally {
        clearInterval(ticking);
        vi.useRealTimers();
      }
    });

    it('waits while the page marks itself busy, its request done, up to SETTLE_MAX_MS', async () => {
      const { tab, contents, requests } = setup();
      onFirstKey(contents, () => {
        requests.sent(mainFrameRequest(contents, 47));
        setTimeout(() => requests.ended(mainFrameRequest(contents, 47)), 100);
        contents.change.busy = true;
      });
      vi.useFakeTimers();
      try {
        const step = timed(tab, { action: 'press', key: 'Enter' });
        await vi.advanceTimersByTimeAsync(SETTLE_MAX_MS - 200);
        expect(step.outcome).toBeNull();
        await vi.advanceTimersByTimeAsync(600);
        expect(step.outcome).toEqual({ changed: false });
        expect(step.at).toBeGreaterThanOrEqual(SETTLE_MAX_MS);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops waiting at SETTLE_MAX_MS for a request that never ends', async () => {
      const { tab, contents, requests } = setup();
      onFirstKey(contents, () => requests.sent(mainFrameRequest(contents, 42)));
      vi.useFakeTimers();
      try {
        const step = timed(tab, { action: 'press', key: 'Enter' });
        await vi.advanceTimersByTimeAsync(SETTLE_MAX_MS - 100);
        expect(step.outcome).toBeNull();
        await vi.advanceTimersByTimeAsync(500);
        expect(step.outcome).toEqual({ changed: false });
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the step and its settle inside the step budget', async () => {
      const { tab, contents, requests } = setup();
      // The key lands only after 32 s, with a request in flight from it.
      onFirstKey(contents, async () => {
        requests.sent(mainFrameRequest(contents, 43));
        await new Promise((resolve) => setTimeout(resolve, 32_000));
      });
      vi.useFakeTimers();
      try {
        const step = timed(tab, { action: 'press', key: 'Enter' });
        await vi.advanceTimersByTimeAsync(STEP_TIMEOUT_MS - 1);
        expect(step.outcome).toEqual({ changed: false });
        expect(step.at).toBeLessThanOrEqual(STEP_TIMEOUT_MS - 500 + 100);
      } finally {
        vi.useRealTimers();
      }
    });

    it("ends the settle at once when the person takes over, and can't tell what changed", async () => {
      const { tab, contents, requests } = setup();
      onFirstKey(contents, () => requests.sent(mainFrameRequest(contents, 44)));
      vi.useFakeTimers();
      try {
        const step = timed(tab, { action: 'press', key: 'Enter' });
        await vi.advanceTimersByTimeAsync(500);
        expect(step.outcome).toBeNull();
        tab.abortInput();
        await vi.advanceTimersByTimeAsync(0);
        expect(step.outcome).toEqual({ changed: null });
      } finally {
        vi.useRealTimers();
      }
    });

    it('answers a navigation as a change, and waits for its new page to go quiet', async () => {
      const { tab, contents } = setup();
      vi.useFakeTimers();
      try {
        const step = timed(tab, { action: 'navigate', url: 'https://b.test/' });
        await vi.advanceTimersByTimeAsync(150 + SETTLE_QUIET_MS - 50);
        expect(step.outcome).toBeNull();
        await vi.advanceTimersByTimeAsync(SETTLE_MAX_MS);
        expect(step.outcome).toEqual({ changed: true });
        expect(step.at).toBeLessThan(150 + SETTLE_QUIET_MS + 300);
      } finally {
        vi.useRealTimers();
      }
      // One watch in the page the step began on, one in the page it reached.
      expect(worldCalls(contents, 'changeStart')).toHaveLength(2);
    });

    it("can't tell for a wait, a page still loading when the step began, a page with a frame or canvas in view, or a hover that changed nothing", async () => {
      const { tab, contents } = setup();
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        expect(await tab.act(stepOf({ action: 'wait', ms: 100 }))).toEqual({ changed: null });
        expect(worldCalls(contents, 'changeStart')).toHaveLength(0);
        contents.loadingMainFrame = true;
        const loading = tab.act(stepOf({ action: 'press', key: 'Enter' }));
        contents.loadingMainFrame = false;
        expect(await loading).toEqual({ changed: null });
        contents.change.opaque = true;
        expect(await tab.act(stepOf({ action: 'press', key: 'Enter' }))).toEqual({ changed: null });
        contents.change.opaque = false;
        expect(await tab.act(stepOf({ action: 'hover', element: 1 }))).toEqual({ changed: null });
        onFirstKey(contents, () => contents.pageChanges());
        expect(await tab.act(stepOf({ action: 'press', key: 'Enter' }))).toEqual({ changed: true });
      } finally {
        vi.useRealTimers();
      }
    });
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
