// Embedded-browser orchestration (see CLAUDE.md §Embedded browser). Owns the
// tab model, one WebContentsView per tab (side map keyed by tab id),
// persistence under coworkHome()/browser, the IPC handlers, and the agent
// bridge startup.
//
// Only the ACTIVE tab's view is ever attached to the window, and only while
// the renderer's Browser route asked for it (`browser:set-visible`). Hiding =
// removeChildView — the webContents stays alive so background tabs keep their
// state. Tab webPreferences get their own session partition
// (persist:cowork-browser) with sandbox + webSecurity ON and no preload: the
// app's loopback Authorization injection lives on the default session and
// must never leak into tabs.

import { BrowserWindow, Menu, WebContentsView, app, clipboard, ipcMain, session, shell } from 'electron';
import type { MenuItemConstructorOptions, WebContents } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IPC } from '../../shared/ipc-channels';
import type { BrowserState, Rect, TopSite } from '../../shared/browser-types';
import { coworkHome } from '../cowork-home';
import * as logic from './browser-logic';
import type { HistoryEntry } from './browser-logic';
import { domPasteScript } from './browser-dom-tools';
import * as input from './browser-input';
import { importChromeHistory } from './chrome-import';
import { startBridge, stopBridge, writeBridgeDiscoveryFile, removeBridgeDiscoveryFile, getBridgeInfo } from './browser-bridge';
import type { BridgeActions, BridgeHandle } from './browser-bridge';

type GetWindow = () => BrowserWindow | null;

const PUSH_DEBOUNCE_MS = 50;
const PERSIST_DEBOUNCE_MS = 500;
const AGENT_CONTROL_MS = 10_000;
const LOAD_SETTLE_MS = 5_000;
// After click/type the triggered navigation may not have hit did-start-loading
// yet — give it this long to appear before concluding nothing navigated.
const LOAD_START_GRACE_MS = 400;
const SCRIPT_TIMEOUT_MS = 8_000;
const SHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Views that were never attached still need a non-zero viewport or
// capturePage/snapshot scripts break on background tabs.
const DEFAULT_VIEW_BOUNDS: Rect = { x: 0, y: 0, width: 1280, height: 800 };
const TAB_PARTITION = 'persist:cowork-browser';

// ---------------------------------------------------------------------------
// Module state (one browser per app)
// ---------------------------------------------------------------------------

let model: BrowserState = logic.emptyBrowserState();
const views = new Map<string, WebContentsView>();
let getWindowRef: GetWindow | null = null;

let wantVisible = false; // renderer asked for the native view (route visible)
let lastBounds: Rect | null = null;
let attachedTabId: string | null = null;
// The window instance attachedTabId's view was added to — macOS recreates the
// window on activate, so attach() must detect the swap and re-attach fully.
let attachedWindow: BrowserWindow | null = null;

// Per-launch stash key for the snapshot→click/type element refs, randomized
// so page JS can't fake or wipe it. Threaded into the bridge's script builders.
const elementStash = `__coworkEls_${crypto.randomBytes(4).toString('hex')}`;

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const agentTimers = new Map<string, ReturnType<typeof setTimeout>>();

let bridgeHandle: BridgeHandle | null = null;
let history: HistoryEntry[] | null = null; // lazy-loaded from history.json

// ---------------------------------------------------------------------------
// Paths + tiny JSON persistence (atomic tmp+rename, like the other stores)
// ---------------------------------------------------------------------------

export function browserDir(): string {
  const dir = path.join(coworkHome(), 'browser');
  // History + session restore live here — owner-only.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function tabsPath(): string {
  return path.join(browserDir(), 'tabs.json');
}

function historyPath(): string {
  return path.join(browserDir(), 'history.json');
}

function chromeCachePath(): string {
  return path.join(browserDir(), 'chrome-import.json');
}

function writeJsonAtomic(file: string, data: unknown): void {
  try {
    const tmp = `${file}.tmp-${process.pid}`;
    // 0600: tabs.json carries full urls (query strings included — needed for
    // session restore) and history.json the redacted visit log.
    fs.writeFileSync(tmp, JSON.stringify(data), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    console.warn(`[browser] failed to write ${path.basename(file)}:`, err);
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Window access + state push (mirrors updater.ts's liveWindow pattern: the
// window can be destroyed and recreated on macOS, so resolve it at use time)
// ---------------------------------------------------------------------------

function liveWindow(): BrowserWindow | null {
  const win = getWindowRef?.();
  return win && !win.isDestroyed() ? win : null;
}

export function getBrowserState(): BrowserState {
  return {
    ...model,
    viewVisible: attachedTabId !== null,
    closedCount: closedStack.length,
    downloads: [...downloads],
  };
}

interface ClosedTabRecord {
  url: string;
  title: string;
  favicon: string | null;
  pinned: boolean;
}

// Recently closed tabs, newest last (⌘⇧T pops). Session-only by design —
// tabs.json already handles deliberate session restore.
const closedStack: ClosedTabRecord[] = [];
const CLOSED_STACK_CAP = 10;

function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    liveWindow()?.webContents.send(IPC.BROWSER_STATE_CHANGED, getBrowserState());
  }, PUSH_DEBOUNCE_MS);
  pushTimer.unref?.();
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistTabs();
  }, PERSIST_DEBOUNCE_MS);
  persistTimer.unref?.();
}

function persistTabs(): void {
  const persisted: logic.PersistedTabs = {
    // error/isLoading are runtime-only — never persisted. Full urls (query
    // strings included) are kept here on purpose: session restore must reopen
    // the exact page. history.json stays redacted (origin + path only).
    tabs: model.tabs.map(({ id, url, title, favicon, pinned, zoom }) => ({ id, url, title, favicon, pinned, zoom: zoom ?? 1 })),
    activeTabId: model.activeTabId,
  };
  writeJsonAtomic(tabsPath(), persisted);
}

function patch(tabId: string, p: Partial<BrowserState['tabs'][number]>): void {
  model = logic.patchTab(model, tabId, p);
  schedulePush();
}

// ---------------------------------------------------------------------------
// Visit history (drives the cowork half of Top Sites)
// ---------------------------------------------------------------------------

function loadHistory(): HistoryEntry[] {
  if (history === null) history = logic.sanitizeHistory(readJson(historyPath()));
  return history;
}

function recordVisit(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  const redacted = logic.redactUrlForLog(url);
  if (!redacted) return;
  history = logic.appendHistoryEntry(loadHistory(), { url: redacted, title: '', ts: Date.now() });
  writeJsonAtomic(historyPath(), history);
}

function recordTitle(url: string, title: string): void {
  const redacted = logic.redactUrlForLog(url);
  if (!redacted) return;
  const next = logic.patchHistoryTitle(loadHistory(), redacted, title);
  if (next !== history) {
    history = next;
    writeJsonAtomic(historyPath(), history);
  }
}

// ---------------------------------------------------------------------------
// View lifecycle
// ---------------------------------------------------------------------------

function navFlags(wc: WebContents): { canGoBack: boolean; canGoForward: boolean } {
  try {
    const nh = wc.navigationHistory;
    return { canGoBack: nh.canGoBack(), canGoForward: nh.canGoForward() };
  } catch {
    // The webContents can die between the event and the read — report none.
    return { canGoBack: false, canGoForward: false };
  }
}

function showContextMenu(tabId: string, wc: WebContents, params: Electron.ContextMenuParams): void {
  const flags = navFlags(wc);
  const template: MenuItemConstructorOptions[] = [
    { label: 'Back', enabled: flags.canGoBack, click: () => void goBack(tabId) },
    { label: 'Forward', enabled: flags.canGoForward, click: () => void goForward(tabId) },
    { label: 'Reload', click: () => void reloadTab(tabId) },
    { type: 'separator' },
  ];
  if (params.linkURL) {
    const link = params.linkURL;
    template.push({ label: 'Copy Link', click: () => clipboard.writeText(link) });
    if (/^(https?:|mailto:)/i.test(link)) {
      template.push({ label: 'Open in Browser', click: () => void shell.openExternal(link) });
    }
  }
  template.push({
    label: 'Inspect Element',
    click: () => {
      wc.openDevTools({ mode: 'detach' });
      wc.inspectElement(params.x, params.y);
    },
  });
  Menu.buildFromTemplate(template).popup();
}

function wireView(tabId: string, view: WebContentsView): void {
  const wc = view.webContents;

  // Page focus must not swallow the tab-strip shortcuts (Codex on #483):
  // the renderer's keydown only fires while the browser CHROME has focus,
  // so ⌘1-9 / Ctrl+Tab are mirrored here per tab view. Same semantics:
  // ⌘1-8 = nth tab, ⌘9 = last, Ctrl(+Shift)+Tab cycles.
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.meta || input.control;
    if (!mod || input.alt) return;
    if (input.key === 'Tab') {
      event.preventDefault();
      cycleActiveTab(input.shift ? -1 : 1);
      return;
    }
    if (!input.shift && input.key >= '1' && input.key <= '9') {
      const idx = input.key === '9' ? model.tabs.length - 1 : Number(input.key) - 1;
      const target = model.tabs[idx];
      if (target) {
        event.preventDefault();
        void activateTabById(target.id);
      }
    }
  });

  wc.on('page-title-updated', (_e, title) => {
    patch(tabId, { title: title ?? '' });
    const tab = model.tabs.find((t) => t.id === tabId);
    if (tab?.url) recordTitle(tab.url, title ?? '');
  });

  wc.on('page-favicon-updated', (_e, favicons) => {
    const first = Array.isArray(favicons) && favicons[0] ? favicons[0] : null;
    patch(tabId, { favicon: logic.sanitizeFaviconUrl(first) });
  });

  wc.on('did-start-loading', () => {
    patch(tabId, { isLoading: true, loadProgress: 0, error: null });
  });

  // Electron has no real load-progress event — synthesize 0 / 0.7 / 1 and let
  // the renderer animate between them.
  wc.on('dom-ready', () => patch(tabId, { loadProgress: 0.7 }));

  wc.on('did-navigate', (_e, url) => {
    patch(tabId, { url: url ?? '', loadProgress: 0.7, error: null, ...navFlags(wc) });
    if (url) recordVisit(url);
    schedulePersist();
    // A new origin starts at ITS session zoom (or 1), not this tab's —
    // re-assert the tab's model zoom over it.
    applyTabZoomToView(tabId);
  });

  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (!isMainFrame) return;
    patch(tabId, { url: url ?? '', ...navFlags(wc) });
    if (url) recordVisit(url);
    schedulePersist();
  });

  wc.on('did-stop-loading', () => {
    patch(tabId, { isLoading: false, loadProgress: 1, ...navFlags(wc) });
  });

  wc.on('did-fail-load', (_e, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    // -3 = ERR_ABORTED (superseded load / stop()) — benign, not an error state.
    if (!isMainFrame || errorCode === -3) return;
    patch(tabId, {
      isLoading: false,
      error: { code: errorCode, description: errorDescription || 'Failed to load' },
    });
  });

  wc.on('render-process-gone', () => {
    patch(tabId, {
      isLoading: false,
      error: { code: -1000, description: 'The tab process crashed' },
    });
  });

  wc.on('context-menu', (_e, params) => showContextMenu(tabId, wc, params));

  // Popups: no new windows — http(s) targets open as a NEW TAB (activated),
  // mailto goes to the OS handler, everything else is denied.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      // newTab can now reject (tab cap, scheme guard) — keep that off the
      // unhandled-rejection path.
      newTab({ url, activate: true }).catch((err) => console.warn('[browser] popup tab failed:', err));
      return { action: 'deny' as const };
    }
    if (/^mailto:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' as const };
  });

  // Defense-in-depth only: will-navigate never fires for programmatic
  // loadURL, so the real scheme guard is isAllowedTabUrl at the load sites.
  // http(s)/about:blank pass; mailto goes to the OS handler (parity with the
  // window.open handler above); everything else stays out of the top frame.
  wc.on('will-navigate', (event, url) => {
    if (/^https?:\/\//i.test(url) || url === 'about:blank') return;
    event.preventDefault();
    if (/^mailto:/i.test(url)) void shell.openExternal(url);
  });
}

function ensureView(tabId: string): WebContentsView | null {
  const existing = views.get(tabId);
  if (existing) return existing;
  const tab = model.tabs.find((t) => t.id === tabId);
  if (!tab) return null;
  const view = new WebContentsView({
    webPreferences: {
      partition: TAB_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  // Never-attached views (background/agent tabs) still need a viewport or
  // capturePage and in-page scripts see a 0x0 page.
  view.setBounds(lastBounds ?? DEFAULT_VIEW_BOUNDS);
  if ((tab.zoom ?? 1) !== 1) view.webContents.setZoomFactor(tab.zoom ?? 1);
  views.set(tabId, view);
  wireView(tabId, view);
  if (tab.url && logic.isAllowedTabUrl(tab.url)) {
    // Fire-and-forget is fine here, but the rejection must be OBSERVED —
    // an unhandled loadURL rejection (e.g. DNS failure on restore) would
    // crash the main process.
    void view.webContents.loadURL(tab.url).catch((err: unknown) => {
      console.warn('[browser] initial tab load failed:', err);
    });
  }
  return view;
}

function destroyView(tabId: string): void {
  const view = views.get(tabId);
  if (!view) return;
  views.delete(tabId);
  primedForWindow.delete(tabId);
  primeInFlight.delete(tabId);
  warmedViews.delete(tabId);
  if (inputHeldViews.delete(tabId) && inputWindow && !inputWindow.isDestroyed()) {
    try {
      inputWindow.contentView.removeChildView(view);
    } catch {
      // already detached
    }
  }
  try {
    view.webContents.close();
  } catch {
    // already gone — nothing to destroy
  }
}

// ---------------------------------------------------------------------------
// Attach / detach / bounds
// ---------------------------------------------------------------------------

function clampBounds(rect: Rect, win: BrowserWindow): Rect {
  const content = win.getContentBounds();
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  return {
    x,
    y,
    width: Math.max(0, Math.min(Math.round(rect.width), content.width - x)),
    height: Math.max(0, Math.min(Math.round(rect.height), content.height - y)),
  };
}

function applyBounds(): void {
  const win = liveWindow();
  if (!win || !attachedTabId || !lastBounds) return;
  views.get(attachedTabId)?.setBounds(clampBounds(lastBounds, win));
}

function attach(tabId: string): void {
  const win = liveWindow();
  if (!win) return;
  const view = ensureView(tabId);
  if (!view) return;
  // attachedTabId alone isn't enough: macOS recreates the window on activate
  // (dock click), and the recorded tab may still be "attached" to the dead
  // window's contentView. Re-attach fully whenever the window instance differs.
  if (attachedTabId !== tabId || attachedWindow !== win) {
    // A behind-attach prime may be in flight — let it finish (it detaches
    // itself) before putting the view on top, or the view could end up
    // double-added / pulled off right after attach.
    const inflight = primeInFlight.get(tabId);
    if (inflight) {
      void inflight.then(() => attach(tabId));
      return;
    }
    // Held on the hidden input window? Pull it off there so the on-top add
    // on the app window is clean.
    if (inputHeldViews.delete(tabId) && inputWindow && !inputWindow.isDestroyed()) {
      try {
        inputWindow.contentView.removeChildView(view);
      } catch {
        // wasn't actually attached — proceed
      }
    }
    if (attachedTabId && attachedWindow && !attachedWindow.isDestroyed()) {
      const current = views.get(attachedTabId);
      if (current) attachedWindow.contentView.removeChildView(current);
    }
    win.contentView.addChildView(view);
    attachedTabId = tabId;
    attachedWindow = win;
  }
  primedForWindow.set(tabId, win);
  applyBounds();
  schedulePush();
}

function detach(): void {
  const win = attachedWindow && !attachedWindow.isDestroyed() ? attachedWindow : liveWindow();
  if (win && attachedTabId) {
    const view = views.get(attachedTabId);
    if (view) win.contentView.removeChildView(view);
  }
  attachedTabId = null;
  attachedWindow = null;
  schedulePush();
}

// ---------------------------------------------------------------------------
// Viewport priming
// ---------------------------------------------------------------------------
// A WebContentsView that has never been attached to a window reports a 0x0
// renderer viewport — setBounds is a no-op while detached, so agent snapshots
// come back empty and pages lay out pathologically. Attaching ONCE behind the
// main webContents (z-index 0, invisible — the renderer paints over it) gives
// the renderer a real size that persists after detaching again. Verified on
// Electron 39: capturePage is the exception — it needs a visibly attached
// view, which capturePng enforces with a clear error instead of a blank PNG.

const primedForWindow = new Map<string, BrowserWindow>();
const primeInFlight = new Map<string, Promise<void>>();

function primeViewport(tabId: string, view: WebContentsView): Promise<void> {
  const win = liveWindow();
  if (!win) return Promise.resolve();
  if (inputHeldViews.has(tabId)) return Promise.resolve(); // on the input window — already real-sized
  if (primedForWindow.get(tabId) === win) return Promise.resolve();
  if (attachedTabId === tabId) {
    // On top is primed by definition.
    if (attachedWindow) primedForWindow.set(tabId, attachedWindow);
    return Promise.resolve();
  }
  const existing = primeInFlight.get(tabId);
  if (existing) return existing;
  const prime = (async () => {
    try {
      view.setBounds(lastBounds ?? DEFAULT_VIEW_BOUNDS);
      win.contentView.addChildView(view, 0); // behind the renderer: invisible
      for (let i = 0; i < 25; i++) {
        const iw = await view.webContents.executeJavaScript('innerWidth').catch(() => 0);
        if (iw) break; // 0/'' = still degenerate; any real size = primed
        await new Promise((r) => setTimeout(r, 20));
      }
      primedForWindow.set(tabId, win);
    } catch {
      // Best effort — scripts still run, just at a degenerate viewport.
    } finally {
      try {
        // attach() may have made this the visible tab mid-prime, and input
        // actions may hold it behind-attached — don't pull either off.
        if (!win.isDestroyed() && attachedTabId !== tabId && !inputHeldViews.has(tabId)) {
          win.contentView.removeChildView(view);
        }
      } catch {
        // already detached — nothing to do
      }
      primeInFlight.delete(tabId);
    }
  })();
  primeInFlight.set(tabId, prime);
  return prime;
}

function setVisible(visible: boolean, bounds?: Rect): void {
  if (bounds) lastBounds = { ...bounds };
  wantVisible = visible;
  if (visible && model.activeTabId) attach(model.activeTabId);
  else if (!visible) detach();
  else schedulePush();
}

function setBounds(rect: Rect): void {
  lastBounds = {
    x: Math.max(0, rect.x),
    y: Math.max(0, rect.y),
    width: Math.max(0, rect.width),
    height: Math.max(0, rect.height),
  };
  applyBounds();
}

// ---------------------------------------------------------------------------
// Tab + navigation actions (shared by IPC handlers and the bridge facade)
// ---------------------------------------------------------------------------

async function newTab(opts: { url?: string; activate?: boolean }): Promise<{ tabId: string }> {
  if (model.tabs.length >= logic.MAX_TABS) {
    throw new logic.BrowserRequestError(`tab limit reached (${logic.MAX_TABS})`);
  }
  const url = opts.url ? logic.normalizeUrlInput(opts.url) : '';
  if (!logic.isAllowedTabUrl(url)) {
    throw new logic.BrowserRequestError(`url not allowed: ${opts.url}`);
  }
  const tab = logic.createTabModel({ url });
  model = logic.addTab(model, tab, opts.activate ?? true);
  schedulePush();
  schedulePersist();
  if (model.activeTabId === tab.id && wantVisible) attach(tab.id);
  // A tab created with a url loads even while the Browser route is hidden —
  // the agent opens tabs without waiting for the user to look at them.
  if (url) ensureView(tab.id);
  return { tabId: tab.id };
}

async function closeTab(tabId?: string): Promise<{ ok: boolean }> {
  const id = tabId ?? model.activeTabId;
  const tab = id ? model.tabs.find((t) => t.id === id) : undefined;
  if (!tab) return { ok: false };
  // Pinned tabs can't be closed (Chrome: no close button, ⌘W skips them) —
  // unpin first. Applies to agent closes too, or a sloppy agent could kill
  // the user's email tab.
  if (tab.pinned) return { ok: false };
  // Record it for ⌘⇧T BEFORE the model transition — the URL is gone after.
  if (tab.url && tab.url !== 'about:blank') {
    closedStack.push({ url: tab.url, title: tab.title, favicon: tab.favicon, pinned: tab.pinned });
    if (closedStack.length > CLOSED_STACK_CAP) closedStack.shift();
  }
  if (attachedTabId === tab.id) detach(); // remove the native view BEFORE destroying it
  const timer = agentTimers.get(tab.id);
  if (timer) clearTimeout(timer);
  agentTimers.delete(tab.id);
  model = logic.removeTab(model, tab.id);
  destroyView(tab.id);
  if (wantVisible && model.activeTabId) attach(model.activeTabId);
  schedulePush();
  schedulePersist();
  return { ok: true };
}

async function setTabPinned(tabId: string, pinned: boolean): Promise<{ ok: boolean }> {
  if (!model.tabs.some((t) => t.id === tabId)) return { ok: false };
  model = logic.setTabPinned(model, tabId, pinned);
  schedulePush();
  schedulePersist();
  return { ok: true };
}

/** Per-tab zoom: patch the model (persisted) and apply to the live view. */
async function setTabZoom(
  tabId: string | undefined,
  direction: 1 | -1 | 0,
): Promise<{ zoom: number } | { ok: false }> {
  const id = requireTab(tabId);
  const tab = model.tabs.find((t) => t.id === id);
  if (!tab) return { ok: false };
  const zoom = logic.nextZoomFactor(tab.zoom ?? 1, direction);
  patch(id, { zoom });
  applyTabZoomToView(id);
  schedulePersist();
  return { zoom };
}

// Electron's setZoomFactor is per-ORIGIN for the session, not per view —
// two tabs on one origin share the rendered zoom (Codex on #485). The
// model is per tab, so re-assert the tab's zoom whenever the view could
// be showing a different origin's value: activation and full navigation.
// Always applied (even 1) so a same-origin neighbour's zoom is undone.
function applyTabZoomToView(tabId: string): void {
  const tab = model.tabs.find((t) => t.id === tabId);
  views.get(tabId)?.webContents.setZoomFactor(tab?.zoom ?? 1);
}

/** ⌘⇧T: reopen the most recently closed tab (fresh load, pin restored). */
async function reopenClosedTab(): Promise<{ tabId: string } | { ok: false }> {
  const record = closedStack[closedStack.length - 1];
  if (!record) return { ok: false };
  // Peek, don't pop: newTab throws at MAX_TABS, and a popped record would
  // be lost — the tab must stay reopenable once the user frees a slot
  // (Codex review on #482).
  const { tabId } = await newTab({ url: record.url, activate: true });
  closedStack.pop();
  if (record.pinned) await setTabPinned(tabId, true);
  schedulePush(); // closedCount changed with the pop
  return { tabId };
}

/** Ctrl(+Shift)+Tab: activate the next/previous tab, wrapping (Chrome). */
function cycleActiveTab(direction: 1 | -1): void {
  const tabs = model.tabs;
  if (tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.id === model.activeTabId);
  const next = tabs[(i + direction + tabs.length) % tabs.length];
  if (next) void activateTabById(next.id);
}

async function activateTabById(tabId: string): Promise<{ ok: boolean }> {
  if (!model.tabs.some((t) => t.id === tabId)) return { ok: false };
  model = logic.activateTab(model, tabId);
  if (wantVisible) attach(tabId);
  applyTabZoomToView(tabId); // undo any same-origin neighbour's zoom
  schedulePush();
  schedulePersist();
  return { ok: true };
}

function requireTab(tabId?: string): string {
  const id = tabId ?? model.activeTabId;
  if (!id || !model.tabs.some((t) => t.id === id)) {
    throw new Error(tabId ? `no such tab: ${tabId}` : 'no active tab');
  }
  return id;
}

async function navigateTo(
  tabId: string | undefined,
  rawUrl: string,
  openInNewTab?: boolean,
): Promise<{ tabId: string; url: string }> {
  const url = logic.normalizeUrlInput(rawUrl);
  if (!url) throw new logic.BrowserRequestError('empty url');
  // Scheme guard BEFORE any model change — a rejected navigation must not
  // poison the tab's url (ensureView would happily keep loading it later).
  if (!logic.isAllowedTabUrl(url)) {
    throw new logic.BrowserRequestError(`url not allowed: ${rawUrl}`);
  }
  let id: string;
  if (openInNewTab) {
    id = (await newTab({ activate: true })).tabId;
  } else {
    id = tabId ?? model.activeTabId ?? (await newTab({ activate: true })).tabId;
    if (!model.tabs.some((t) => t.id === id)) throw new Error(`no such tab: ${id}`);
  }
  const existed = views.has(id);
  patch(id, { url, error: null });
  const view = ensureView(id); // a fresh view already loads tab.url (now = new url)
  if (!view) throw new Error(`no such tab: ${id}`);
  if (existed) {
    try {
      await view.webContents.loadURL(url);
    } catch (err) {
      // -3 ERR_ABORTED = this load was superseded by a newer one (rapid
      // double-navigate). The newer call owns the outcome — success.
      if (!(err instanceof Error) || !err.message.includes('ERR_ABORTED')) throw err;
    }
  }
  return { tabId: id, url };
}

async function goBack(tabId?: string): Promise<{ ok: boolean; moved?: boolean }> {
  const id = requireTab(tabId);
  const wc = views.get(id)?.webContents;
  if (!wc) return { ok: false };
  if (!wc.navigationHistory?.canGoBack()) return { ok: true, moved: false };
  wc.navigationHistory.goBack();
  return { ok: true, moved: true };
}

async function goForward(tabId?: string): Promise<{ ok: boolean; moved?: boolean }> {
  const id = requireTab(tabId);
  const wc = views.get(id)?.webContents;
  if (!wc) return { ok: false };
  if (!wc.navigationHistory?.canGoForward()) return { ok: true, moved: false };
  wc.navigationHistory.goForward();
  return { ok: true, moved: true };
}

async function reloadTab(tabId?: string): Promise<{ ok: boolean }> {
  const id = requireTab(tabId);
  const wc = views.get(id)?.webContents;
  if (!wc) return { ok: false };
  wc.reload();
  return { ok: true };
}

async function stopTab(tabId?: string): Promise<{ ok: boolean }> {
  const id = requireTab(tabId);
  const wc = views.get(id)?.webContents;
  if (!wc) return { ok: false };
  wc.stop();
  return { ok: true };
}

function openDevTools(tabId?: string): void {
  const id = requireTab(tabId);
  views.get(id)?.webContents.openDevTools({ mode: 'detach' });
}

interface FindResult {
  matches: number;
  activeMatchOrdinal: number;
}

async function findInPage(tabId: string | undefined, opts: { text: string; forward?: boolean; findNext?: boolean }): Promise<FindResult | { ok: false }> {
  const text = String(opts.text ?? '').trim();
  if (!text) return { ok: false };
  const view = views.get(requireTab(tabId));
  if (!view) return { ok: false };
  const wc = view.webContents;
  return new Promise((resolve) => {
    const requestId = wc.findInPage(text, { forward: opts.forward ?? true, findNext: opts.findNext === true });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFound = (_e: unknown, result: { requestId: number; matches: number; activeMatchOrdinal: number }) => {
      if (result.requestId !== requestId) return;
      wc.removeListener('found-in-page', onFound);
      if (timer) clearTimeout(timer);
      resolve({ matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal });
    };
    wc.on('found-in-page', onFound);
    timer = setTimeout(() => {
      wc.removeListener('found-in-page', onFound);
      resolve({ matches: 0, activeMatchOrdinal: 0 });
    }, 3000);
    timer.unref?.();
  });
}

function stopFindInPage(tabId?: string): { ok: boolean } {
  const view = views.get(requireTab(tabId));
  if (!view) return { ok: false };
  view.webContents.stopFindInPage('clearSelection');
  return { ok: true };
}

async function topSites(limit?: number): Promise<TopSite[]> {
  const cowork = logic.historyToTopSites(loadHistory());
  const chrome = await importChromeHistory(chromeCachePath(), { force: false });
  return logic.mergeTopSites(chrome.sites, cowork, limit ?? 12);
}

async function importChrome(): Promise<{ imported: number; profiles: string[]; error?: string }> {
  const result = await importChromeHistory(chromeCachePath(), { force: true });
  return { imported: result.imported, profiles: result.profiles, error: result.error };
}

// ---------------------------------------------------------------------------
// Web apps registry (sidebar launcher; apps.json in browserDir)
// ---------------------------------------------------------------------------

let apps: logic.BrowserApp[] | null = null; // lazy-loaded

function appsPath(): string {
  return path.join(browserDir(), 'apps.json');
}

function loadApps(): logic.BrowserApp[] {
  if (apps === null) apps = logic.sanitizeApps(readJson(appsPath()));
  return apps;
}

function listApps(): logic.BrowserApp[] {
  return loadApps();
}

function addApp(input: { name?: string; origin?: string; favicon?: string }): logic.BrowserApp | { error: string } {
  const raw = String(input.origin ?? '').trim();
  if (!/^https?:\/\//i.test(raw)) return { error: 'origin must be an http(s) URL' };
  const origin = new URL(raw).origin;
  const current = loadApps();
  const existing = current.find((a) => a.origin === origin);
  if (existing) return existing; // idempotent — one app per origin
  const app: logic.BrowserApp = {
    id: logic.appIdForOrigin(origin),
    name: String(input.name ?? '').trim() || logic.suggestAppName(origin),
    origin,
    favicon: logic.sanitizeFaviconUrl(typeof input.favicon === 'string' ? input.favicon : null),
    createdAt: Date.now(),
  };
  apps = [...current, app];
  writeJsonAtomic(appsPath(), apps);
  return app;
}

function removeApp(appId: string): { ok: boolean } {
  const current = loadApps();
  if (!current.some((a) => a.id === appId)) return { ok: false };
  apps = current.filter((a) => a.id !== appId);
  writeJsonAtomic(appsPath(), apps);
  return { ok: true };
}

function renameApp(appId: string, name: string): logic.BrowserApp | { error: string } {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return { error: 'name required' };
  const current = loadApps();
  const app = current.find((a) => a.id === appId);
  if (!app) return { error: `no such app: ${appId}` };
  app.name = trimmed;
  writeJsonAtomic(appsPath(), current);
  return app;
}

/** Find-or-create: activate the tab already on the app's origin, else open a
 *  fresh pinned tab there. The sidebar's "Email is a place, not a tab". */
async function openApp(appId: string): Promise<{ tabId: string; created: boolean } | { error: string }> {
  const app = loadApps().find((a) => a.id === appId);
  if (!app) return { error: `no such app: ${appId}` };
  const existing = model.tabs.find((t) => logic.tabMatchesApp(t.url, app.origin));
  if (existing) {
    await activateTabById(existing.id);
    return { tabId: existing.id, created: false };
  }
  const { tabId } = await newTab({ url: app.origin, activate: true });
  await setTabPinned(tabId, true);
  return { tabId, created: true };
}

// ---------------------------------------------------------------------------
// Agent bridge facade
// ---------------------------------------------------------------------------

function markAgentControlled(tabId?: string): void {
  const id = tabId ?? model.activeTabId;
  if (!id || !model.tabs.some((t) => t.id === id)) return;
  patch(id, { isAgentControlled: true });
  const existing = agentTimers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    agentTimers.delete(id);
    patch(id, { isAgentControlled: false });
  }, AGENT_CONTROL_MS);
  timer.unref?.();
  agentTimers.set(id, timer);
}

function waitForLoadSettle(tabId?: string): Promise<void> {
  const id = tabId ?? model.activeTabId;
  const wc = (id && views.get(id)?.webContents) || null;
  if (!wc) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (graceTimer) clearTimeout(graceTimer);
      if (stopTimer) clearTimeout(stopTimer);
      wc.removeListener('did-start-loading', onStart);
      wc.removeListener('did-stop-loading', finish);
      resolve();
    };
    // A load started — now wait for it to finish (bounded by LOAD_SETTLE_MS).
    const onStart = () => {
      if (graceTimer) clearTimeout(graceTimer);
      graceTimer = null;
      wc.removeListener('did-start-loading', onStart);
      wc.once('did-stop-loading', finish);
      stopTimer = setTimeout(finish, LOAD_SETTLE_MS);
      stopTimer.unref?.();
    };
    if (wc.isLoading()) {
      onStart();
      return;
    }
    // A click/type may not have hit did-start-loading yet — resolving here on
    // !isLoading() would read the pre-click page. Wait a grace window for a
    // load to appear; none starting means no navigation happened.
    wc.once('did-start-loading', onStart);
    graceTimer = setTimeout(finish, LOAD_START_GRACE_MS);
    graceTimer.unref?.();
  });
}

async function runScript(tabId: string | undefined, script: string): Promise<unknown> {
  const id = requireTab(tabId);
  const view = ensureView(id);
  if (!view) throw new Error(`no such tab: ${id}`);
  // A never-attached view has a 0x0 renderer viewport — prime it or the
  // snapshot/read/click scripts see an empty, mis-laid-out page.
  await primeViewport(id, view);
  // executeJavaScript has no built-in timeout — a page that wedges the
  // evaluate (busy main thread, hostile while(true)) must not hang the bridge.
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      view.webContents.executeJavaScript(script),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`script timed out after ${SCRIPT_TIMEOUT_MS}ms`)), SCRIPT_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Input attachment
// ---------------------------------------------------------------------------
// CDP trusted input needs the view attached to a window that has been SHOWN
// with that view attached (proven: never-shown or fully-offscreen windows
// route nothing; a view attached during one 300ms show stays input-ready
// across detach/re-attach afterwards). The input stage is a dedicated window
// parked 87% off the left screen edge — its 300ms warm cycle is a ~100px
// sliver flash, once per tab per app session, only when trusted input is
// actually used on a non-visible tab. The user's real focus is never touched.

const INPUT_HOLD_MS = 5000;
const INPUT_WARM_MS = 350;
const inputHeldViews = new Set<string>();
const warmedViews = new Set<string>();
let inputHoldTimer: ReturnType<typeof setTimeout> | null = null;
let inputWindow: BrowserWindow | null = null;
let inputWarmChain: Promise<void> = Promise.resolve();

function getInputWindow(): BrowserWindow {
  if (inputWindow && !inputWindow.isDestroyed()) return inputWindow;
  const win = new BrowserWindow({
    show: false,
    x: -1340, // ~100px sliver on the primary display's left edge — near-invisible
    y: 50,
    width: 1440,
    height: 900,
    skipTaskbar: true,
    focusable: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  void win.loadURL('about:blank').catch(() => {});
  win.on('closed', () => {
    inputWindow = null;
    inputHeldViews.clear();
    warmedViews.clear(); // a new window must re-warm every view
  });
  inputWindow = win;
  return win;
}

function releaseInputHolds(): void {
  const win = inputWindow;
  for (const id of [...inputHeldViews]) {
    inputHeldViews.delete(id);
    const view = views.get(id);
    if (win && !win.isDestroyed() && view) {
      try {
        win.contentView.removeChildView(view);
      } catch {
        // already detached
      }
    }
  }
  inputHoldTimer = null;
}

/** One show-cycle per view (serialized): attach → show → hide → input-ready. */
async function warmViewForInput(tabId: string): Promise<void> {
  if (warmedViews.has(tabId)) return;
  const win = getInputWindow();
  const job = inputWarmChain.then(async () => {
    if (warmedViews.has(tabId) || win.isDestroyed()) return;
    win.showInactive();
    await new Promise((r) => setTimeout(r, INPUT_WARM_MS));
    if (!win.isDestroyed()) win.hide();
    warmedViews.add(tabId);
  });
  inputWarmChain = job.catch(() => {});
  await job;
}

async function attachForInput(tabId: string, view: WebContentsView): Promise<void> {
  if (attachedTabId === tabId && attachedWindow && !attachedWindow.isDestroyed()) {
    return; // already the visible tab on the app window — input works there
  }
  if (!inputHeldViews.has(tabId)) {
    const win = getInputWindow();
    // Pin to (0,0) on the input window — lastBounds' x/y is the placeholder's
    // position in the MAIN window, which would push most of the view outside
    // this one, and clipped regions silently cull input. Only the SIZE is
    // borrowed (layout fidelity vs. what the user sees when the tab is visible).
    const w = Math.min(1440, Math.max(400, lastBounds?.width ?? 1280));
    const h = Math.min(900, Math.max(300, lastBounds?.height ?? 800));
    view.setBounds({ x: 0, y: 0, width: w, height: h });
    win.contentView.addChildView(view);
    inputHeldViews.add(tabId);
    primedForWindow.set(tabId, win);
  }
  await warmViewForInput(tabId);
  if (inputHoldTimer) clearTimeout(inputHoldTimer);
  inputHoldTimer = setTimeout(releaseInputHolds, INPUT_HOLD_MS);
  inputHoldTimer.unref?.();
}

// ---------------------------------------------------------------------------
// Trusted input actions (CDP) — for canvas-rendered apps where the synthetic
// DOM primitives (click/type by snapshot index) are ignored.
// ---------------------------------------------------------------------------

async function requireLoadedView(tabId: string | undefined) {
  const id = requireTab(tabId);
  const view = ensureView(id);
  if (!view) throw new Error(`no such tab: ${id}`);
  return { id, view };
}

/** Shared shape of the trusted-input actions: resolve the view, stage it for
 *  input (hidden input window for background tabs), run one CDP action. */
async function withInputView(
  tabId: string | undefined,
  act: (view: WebContentsView) => Promise<void>,
): Promise<{ ok: boolean }> {
  const { id, view } = await requireLoadedView(tabId);
  await attachForInput(id, view);
  await act(view);
  return { ok: true };
}

const clickAt = (tabId: string | undefined, x: number, y: number) =>
  withInputView(tabId, (view) => input.trustedClick(view.webContents, x, y));

const pressKey = (tabId: string | undefined, key: string, modifiers?: string[]) =>
  withInputView(tabId, (view) => input.trustedKey(view.webContents, key, modifiers));

const insertText = (tabId: string | undefined, text: string) =>
  withInputView(tabId, (view) => input.trustedInsertText(view.webContents, text));

/** Paste text (e.g. a TSV block) into the focused element via a synthetic
 *  ClipboardEvent. Proven against Google Sheets: Sheets parses TSV into a
 *  cell range from the event's clipboardData. Works on detached views too —
 *  it's ordinary JS, not input — so no attach is needed. */
async function pasteText(tabId: string | undefined, text: string): Promise<{ ok: boolean }> {
  const { id } = await requireLoadedView(tabId);
  await runScript(id, domPasteScript(text));
  return { ok: true };
}

async function capturePng(tabId?: string): Promise<Buffer> {
  const id = requireTab(tabId);
  // capturePage reads the compositor frame — a detached or occluded view has
  // none and returns a 0x0 image. Only a visibly attached tab can be captured.
  const win = liveWindow();
  const view = views.get(id);
  const visible =
    !!view && !!win && !win.isDestroyed() && attachedTabId === id && attachedWindow === win;
  if (!visible) {
    throw new logic.BrowserRequestError(
      'screenshot needs the tab on screen: activate it while the Browser view is open',
    );
  }
  const image = await view.webContents.capturePage();
  if (image.isEmpty()) {
    throw new logic.BrowserRequestError('screenshot came back empty — the tab may still be rendering');
  }
  return image.toPNG();
}

// Freeze-frame for the collapsed sidebar rail: rail tooltips can't paint
// over the native view, so hovering the rail hides it — and the renderer
// swaps this still in as the placeholder background so the page never
// "vanishes". Same compositor rules as capturePng (only a visibly attached
// tab has a frame), but a null — the renderer falls back to a bare hide —
// beats a thrown error mid-hover.
async function captureSnapshotDataUrl(tabId?: string): Promise<string | null> {
  const id = tabId ?? model.activeTabId;
  if (!id) return null;
  const win = liveWindow();
  const view = views.get(id);
  const visible =
    !!view && !!win && !win.isDestroyed() && attachedTabId === id && attachedWindow === win;
  if (!visible) return null;
  try {
    const image = await view.webContents.capturePage();
    if (image.isEmpty()) return null;
    return `data:image/jpeg;base64,${image.toJPEG(78).toString('base64')}`;
  } catch {
    return null;
  }
}

/** Viewport CSS size + pixel scale of the last screenshot — the agent needs
 *  the scale to map screenshot pixels back to click-at CSS coordinates
 *  (Retina captures are 2x). */
async function viewportInfo(tabId?: string): Promise<{ cssWidth: number; cssHeight: number; scale: number }> {
  const id = requireTab(tabId);
  const view = views.get(id);
  if (!view) throw new Error(`no such tab: ${id}`);
  const size = (await view.webContents.executeJavaScript(
    'JSON.stringify({ w: innerWidth, h: innerHeight, dpr: window.devicePixelRatio || 1 })',
  )) as string;
  const { w, h, dpr } = JSON.parse(size) as { w: number; h: number; dpr: number };
  return { cssWidth: w, cssHeight: h, scale: dpr };
}

function saveScreenshot(png: Buffer): string {
  const dir = path.join(os.tmpdir(), 'cowork-browser-shots');
  fs.mkdirSync(dir, { recursive: true });
  pruneScreenshots(dir);
  const file = path.join(dir, `shot-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`);
  fs.writeFileSync(file, png);
  return file;
}

/** Drop screenshots older than 24 h — the tmp dir would grow without bound
 *  otherwise (tmp cleaners don't run on a schedule we can rely on). */
function pruneScreenshots(dir: string): void {
  try {
    const cutoff = Date.now() - SHOT_MAX_AGE_MS;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('shot-') || !name.endsWith('.png')) continue;
      try {
        const file = path.join(dir, name);
        if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
      } catch {
        // one unreadable entry must not stop the prune
      }
    }
  } catch {
    // dir unreadable — saving the new shot is still worth trying
  }
}

const bridgeActions: BridgeActions = {
  getState: getBrowserState,
  newTab,
  closeTab,
  activateTab: activateTabById,
  navigate: navigateTo,
  goBack,
  goForward,
  reload: reloadTab,
  runScript,
  clickAt,
  pressKey,
  insertText,
  pasteText,
  capturePng,
  viewportInfo,
  topSites,
  listApps,
  openApp,
  markAgentControlled,
  waitForLoadSettle,
  saveScreenshot,
};

/** Start the loopback agent bridge (called once, after createWindow) and
 *  write the discovery file the Python side resolves. Idempotent. */
export async function startBrowserBridge(): Promise<{ port: number; token: string } | null> {
  if (bridgeHandle) return { port: bridgeHandle.port, token: bridgeHandle.token };
  try {
    bridgeHandle = await startBridge(bridgeActions, { elementStash });
    writeBridgeDiscoveryFile(coworkHome(), bridgeHandle.port, bridgeHandle.token);
    console.log(`[browser] agent bridge on http://127.0.0.1:${bridgeHandle.port}`);
    return { port: bridgeHandle.port, token: bridgeHandle.token };
  } catch (err) {
    console.error('[browser] bridge start failed:', err);
    return null;
  }
}

export function getBrowserBridge(): { port: number; token: string } | null {
  return getBridgeInfo();
}

// ---------------------------------------------------------------------------
// IPC registration + restore
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Downloads shelf: last 10 downloads, newest first (session-only)
// ---------------------------------------------------------------------------

export interface DownloadInfo {
  id: string;
  filename: string;
  savePath: string;
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  startedAt: number;
}

const downloads: DownloadInfo[] = [];
let downloadCounter = 0;
const DOWNLOADS_CAP = 10;

function trackDownload(item: Electron.DownloadItem, savePath: string): void {
  const info: DownloadInfo = {
    id: `dl-${++downloadCounter}`,
    filename: path.basename(savePath),
    savePath,
    totalBytes: item.getTotalBytes(),
    receivedBytes: item.getReceivedBytes(),
    state: 'progressing',
    startedAt: Date.now(),
  };
  downloads.unshift(info);
  if (downloads.length > DOWNLOADS_CAP) downloads.pop();
  schedulePush();
  item.on('updated', (_e, state) => {
    info.receivedBytes = item.getReceivedBytes();
    info.state = state === 'interrupted' ? 'interrupted' : 'progressing';
    schedulePush();
  });
  item.once('done', (_e, state) => {
    info.receivedBytes = item.getReceivedBytes();
    info.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted';
    schedulePush();
  });
}

function listDownloads(): DownloadInfo[] {
  return downloads;
}

let tabSessionConfigured = false;

/** One-time hardening of the tabs' session partition: deny every permission
 *  request/check (camera, mic, notifications — matches the app's posture)
 *  and route downloads to the OS Downloads folder with a deduped name. */
function configureTabSession(): void {
  if (tabSessionConfigured) return;
  tabSessionConfigured = true;
  const tabSession = session.fromPartition(TAB_PARTITION);
  tabSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  tabSession.setPermissionCheckHandler(() => false);
  tabSession.on('will-download', (_event, item) => {
    try {
      const dir = app.getPath('downloads');
      const name = logic.dedupeDownloadName(item.getFilename(), (candidate) =>
        fs.existsSync(path.join(dir, candidate)),
      );
      const savePath = path.join(dir, name);
      item.setSavePath(savePath);
      trackDownload(item, savePath);
    } catch (err) {
      console.warn('[browser] download failed:', err);
    }
  });
}

function restoreTabs(): void {
  const persisted = logic.sanitizePersistedTabs(readJson(tabsPath()));
  if (!persisted || persisted.tabs.length === 0) return;
  model = {
    ...model,
    tabs: persisted.tabs.map((t) => logic.createTabModel(t)),
    activeTabId: persisted.activeTabId,
  };
  // Records only — no views, no loads. Views materialize lazily on first
  // set-visible/activate/bridge-touch (ensureView), so app launch fires no
  // network traffic or phantom history visits for tabs the user never opens.
}

export function registerBrowserHandlers(getWindow: GetWindow): void {
  getWindowRef = getWindow;
  configureTabSession();
  restoreTabs();

  ipcMain.handle(IPC.BROWSER_GET_STATE, () => getBrowserState());
  ipcMain.handle(IPC.BROWSER_SET_VISIBLE, (_e, payload: { visible?: boolean; bounds?: Rect }) => {
    setVisible(payload?.visible === true, payload?.bounds);
  });
  ipcMain.handle(IPC.BROWSER_CAPTURE_SNAPSHOT, (_e, payload: { tabId?: string }) =>
    captureSnapshotDataUrl(payload?.tabId),
  );
  ipcMain.handle(IPC.BROWSER_SET_BOUNDS, (_e, rect: Rect) => {
    if (rect) setBounds(rect);
  });
  ipcMain.handle(IPC.BROWSER_NEW_TAB, (_e, opts: { url?: string; activate?: boolean }) =>
    newTab(opts ?? {}),
  );
  ipcMain.handle(IPC.BROWSER_CLOSE_TAB, (_e, payload: { tabId?: string }) =>
    closeTab(payload?.tabId),
  );
  ipcMain.handle(IPC.BROWSER_ACTIVATE_TAB, (_e, payload: { tabId?: string }) =>
    payload?.tabId ? activateTabById(payload.tabId) : { ok: false },
  );
  ipcMain.handle(IPC.BROWSER_PIN_TAB, (_e, payload: { tabId?: string; pinned?: boolean }) =>
    payload?.tabId ? setTabPinned(payload.tabId, payload.pinned === true) : { ok: false },
  );
  ipcMain.handle(IPC.BROWSER_APPS_LIST, () => listApps());
  ipcMain.handle(IPC.BROWSER_APPS_ADD, (_e, payload: { name?: string; origin?: string }) =>
    addApp(payload ?? {}),
  );
  ipcMain.handle(IPC.BROWSER_APPS_REMOVE, (_e, payload: { appId?: string }) =>
    payload?.appId ? removeApp(payload.appId) : { ok: false },
  );
  ipcMain.handle(IPC.BROWSER_APPS_RENAME, (_e, payload: { appId?: string; name?: string }) =>
    payload?.appId ? renameApp(payload.appId, String(payload?.name ?? '')) : { error: 'appId required' },
  );
  ipcMain.handle(IPC.BROWSER_OPEN_APP, (_e, payload: { appId?: string }) =>
    payload?.appId ? openApp(payload.appId) : { error: 'appId required' },
  );
  ipcMain.handle(IPC.BROWSER_FIND_IN_PAGE, (_e, payload: { tabId?: string; text?: string; forward?: boolean; findNext?: boolean }) =>
    payload?.text ? findInPage(payload.tabId, { text: payload.text, forward: payload.forward, findNext: payload.findNext }) : { ok: false },
  );
  ipcMain.handle(IPC.BROWSER_STOP_FIND, (_e, payload: { tabId?: string }) => stopFindInPage(payload?.tabId));
  ipcMain.handle(IPC.BROWSER_REOPEN_CLOSED_TAB, () => reopenClosedTab());
  ipcMain.handle(IPC.BROWSER_DOWNLOADS_LIST, () => listDownloads());
  ipcMain.handle(IPC.BROWSER_SET_ZOOM, (_e, payload: { tabId?: string; direction?: 1 | -1 | 0 }) =>
    payload?.direction === 1 || payload?.direction === -1 || payload?.direction === 0
      ? setTabZoom(payload.tabId, payload.direction)
      : { ok: false },
  );
  ipcMain.handle(IPC.BROWSER_NAVIGATE, async (_e, payload: { tabId?: string; url?: string }) => {
    if (!payload?.url) return;
    try {
      await navigateTo(payload.tabId, payload.url);
    } catch (err) {
      console.warn('[browser] navigate failed:', err);
    }
  });
  ipcMain.handle(IPC.BROWSER_GO_BACK, (_e, p: { tabId?: string }) => goBack(p?.tabId).catch(() => ({ ok: false })));
  ipcMain.handle(IPC.BROWSER_GO_FORWARD, (_e, p: { tabId?: string }) => goForward(p?.tabId).catch(() => ({ ok: false })));
  ipcMain.handle(IPC.BROWSER_RELOAD, (_e, p: { tabId?: string }) => reloadTab(p?.tabId).catch(() => ({ ok: false })));
  ipcMain.handle(IPC.BROWSER_STOP, (_e, p: { tabId?: string }) => stopTab(p?.tabId).catch(() => ({ ok: false })));
  ipcMain.handle(IPC.BROWSER_OPEN_DEVTOOLS, (_e, p: { tabId?: string }) => {
    try {
      openDevTools(p?.tabId);
    } catch {
      // no such tab — nothing to inspect
    }
  });
  ipcMain.handle(IPC.BROWSER_TOP_SITES, (_e, payload: { limit?: number }) =>
    topSites(payload?.limit),
  );
  ipcMain.handle(IPC.BROWSER_IMPORT_CHROME, () => importChrome());
}

// ---------------------------------------------------------------------------
// Shutdown (before-quit): close the bridge, destroy views, persist
// ---------------------------------------------------------------------------

export async function shutdownBrowser(): Promise<void> {
  if (pushTimer) clearTimeout(pushTimer);
  if (persistTimer) clearTimeout(persistTimer);
  for (const timer of agentTimers.values()) clearTimeout(timer);
  agentTimers.clear();
  pushTimer = null;
  persistTimer = null;

  try {
    await stopBridge();
  } catch {
    // bridge may never have started — shutdown must not fail on it
  }
  bridgeHandle = null;
  // A stale discovery file would send the next launch's Python side (or a
  // retry after a clean quit) to a dead port with an old token.
  removeBridgeDiscoveryFile(coworkHome());

  for (const tabId of [...views.keys()]) destroyView(tabId);
  attachedTabId = null;
  attachedWindow = null;
  primedForWindow.clear();
  primeInFlight.clear();
  inputHeldViews.clear();
  warmedViews.clear();
  if (inputHoldTimer) {
    clearTimeout(inputHoldTimer);
    inputHoldTimer = null;
  }
  if (inputWindow && !inputWindow.isDestroyed()) inputWindow.destroy();
  inputWindow = null;

  persistTabs();
  if (history !== null) writeJsonAtomic(historyPath(), history);
}
