/*
 * The in-app browser host: wires the bridge, the task sessions, the account's
 * profile, the registration with the local server and the pane's IPC.
 *
 * Lifecycle:
 * - At app start the bridge listens on 127.0.0.1 with a fresh 32-byte key.
 * - The pane's UI sends browser:ready once it can show the in-app browser.
 *   Only then, and only while the app's window exists, does main register
 *   {url, token} with the local server: after ready, after every server start
 *   or adoption (the started hook), and after a key change. A UI that never
 *   sends ready (an older one) never gets the browser tool.
 * - On an account or organization switch (the server restarts on other
 *   stores) every task closes, the key changes, and the browser moves to the
 *   new account's profile.
 * - When the window closes, every task closes, the bridge answers 503 and the
 *   registration is cleared. A main-frame reload of the window (a UI update)
 *   hides the browser and clears the registration until the new UI is ready.
 *
 * Every IPC handler refuses a sender other than the app's own main frame, so
 * the document preview frame, or anything else inside the window, can't drive
 * the browser.
 *
 * Below Electron 44 the host hosts nothing: the bridge never listens and
 * nothing is registered, so the shell's turns get no browser tool.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import type { BrowserWindow, DownloadItem, IpcMain, IpcMainInvokeEvent, Session, WebContents } from 'electron';
import { diagnostic } from '../shared/diagnostics';
import { IPC } from '../shared/ipc-channels';
import {
  type BrowserDownload,
  type BrowserViewState,
  electronHostsInAppBrowser,
  parseLoginAnswer,
  parseStageBounds,
  SESSION_ID_PATTERN,
  type StageBounds,
} from '../shared/browser-contract';
import { type Bridge, startBridge } from './browser-bridge';
import { browserProfilePath, configureBrowserSession, ensureProfileDir } from './browser-profile';
import { BrowserRegistration } from './browser-register';
import { BrowserSessions, type TabFactory, type TabHooks, type ViewBounds } from './browser-sessions';
import { BrowserStore } from './browser-store';
import { electronTabFactory, type TabContext } from './browser-view';

const IDLE_SWEEP_MS = 60_000;
/* Under the account's data root: downloads that wait for the person's Save. */
const DOWNLOAD_STAGING = 'browser-downloads';
const TAB_ID_PATTERN = /^t\d{1,4}$/;

export function newBridgeToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The account's own folder inside the OS Downloads folder: downloads never
    land loose in it. The account on the app's default root gets "Cowork
    browser"; another account's folder adds the start of its id. */
export function accountDownloadsFolder(downloadsDir: string, accountRoot: string): string {
  const parent = path.basename(path.dirname(accountRoot));
  const id = path.basename(accountRoot).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
  return path.join(downloadsDir, parent === 'accounts' && id ? `Cowork browser ${id}` : 'Cowork browser');
}

/* Moves a finished download into place; across volumes, a copy then a delete. */
function moveFile(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
  }
}

/* A download that started while the agent held the browser. It saves into the
   account's staging folder, paused, and moves into Downloads only once the
   person says yes. */
interface WaitingDownload {
  /** The task whose pane may answer it, or null for a page no task owns. */
  sessionId: string | null;
  item: DownloadItem;
  hooks: TabHooks | undefined;
  name: string;
  folder: string;
  staged: string;
  /** null until the person answers. */
  save: boolean | null;
  /** The item finished before the person answered. */
  finished: boolean;
}

/** A file name for a download in `dir` that is safe and not taken. */
export function uniqueDownloadPath(dir: string, suggested: string): string {
  const base = path.basename(suggested.replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '').trim() || 'download';
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length) || 'download';
  for (let n = 0; ; n += 1) {
    const name = n === 0 ? `${stem}${ext}` : `${stem} (${n})${ext}`;
    const candidate = path.join(dir, name);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

export interface InAppBrowserDeps {
  /** The local server's port, whether or not it runs: pages may never reach it. */
  serverPort(): number;
  /** The port to register with: the local server's while it runs or starts, else null. */
  runningServerPort(): number | null;
  authHeader(): Record<string, string>;
  /** The signed-in account's data root, and the stores the server runs on. */
  accountRoot(): string;
  /** The app's userData folder, where the browser profiles live (`app.getPath('userData')`). */
  userDataDir(): string;
  storesRoot(): string | null;
  downloadsDir(): string;
  /** session.fromPath. */
  profileSession(dir: string): Session;
  fetch: typeof fetch;
  /** This shell's Electron version (`process.versions.electron`). */
  electronVersion(): string | undefined;
  /** Tests give fake tabs; the app gives Electron's. */
  tabFactory?: (ctx: TabContext) => TabFactory;
}

export class InAppBrowserHost {
  private bridge: Bridge | null = null;
  private token = newBridgeToken();
  private window: BrowserWindow | null = null;
  private rendererReady = false;
  private identity: string | null = null;
  private profile: { root: string; session: Session } | null = null;
  private readonly owners = new WeakMap<WebContents, TabHooks>();
  private readonly waitingDownloads = new Map<string, WaitingDownload>();
  /* session.fromPath returns the same session for the same folder, so an
     account switched away from and back to is configured only once. */
  private readonly configured = new WeakSet<Session>();
  private readonly sessions: BrowserSessions;
  private readonly registration: BrowserRegistration;
  private sweep: NodeJS.Timeout | null = null;

  constructor(private readonly deps: InAppBrowserDeps) {
    const ctx: TabContext = {
      window: () => this.window,
      session: () => this.profileSession(),
      register: (contents, hooks) => this.owners.set(contents, hooks),
    };
    this.sessions = new BrowserSessions({
      factory: (deps.tabFactory ?? electronTabFactory)(ctx),
      emit: (state) => this.sendState(state),
      cookies: (site) => this.cookiesFor(site),
    });
    this.registration = new BrowserRegistration({
      serverPort: deps.runningServerPort,
      authHeader: deps.authHeader,
      fetch: deps.fetch,
    });
  }

  /** Whether this shell's Electron may host the in-app browser. */
  supported(): boolean {
    return electronHostsInAppBrowser(this.deps.electronVersion());
  }

  /** Starts the bridge. Called once, when the app is ready. Below Electron 44
      nothing starts, so nothing can ever be registered. */
  async start(): Promise<void> {
    if (!this.supported()) {
      diagnostic('main.browser-host', 'INFO', 'browser_host_off_on_unsupported_electron', `[browser-host] off: Electron ${this.deps.electronVersion() ?? 'unknown'} is below the supported floor`);
      return;
    }
    this.bridge = await startBridge({
      token: () => this.token,
      sessions: this.sessions,
      store: () => BrowserStore.forAccountRoot(this.deps.accountRoot()),
    });
    this.sweep = setInterval(() => this.sessions.sweepIdle(), IDLE_SWEEP_MS);
    this.sweep.unref();
  }

  async stop(): Promise<void> {
    if (this.sweep) clearInterval(this.sweep);
    this.sessions.closeAll();
    await this.bridge?.close();
    this.bridge = null;
  }

  /** The key this launch's bridge accepts. For tests. */
  currentToken(): string {
    return this.token;
  }

  bridgeUrl(): string | null {
    return this.bridge?.url ?? null;
  }

  // ---- The profile ---------------------------------------------------------------

  private profileSession(): Session {
    const root = this.deps.accountRoot();
    if (this.profile?.root === root) return this.profile.session;
    const dir = browserProfilePath(this.deps.userDataDir(), root);
    ensureProfileDir(dir);
    const ses = this.deps.profileSession(dir);
    if (!this.configured.has(ses)) {
      this.configured.add(ses);
      // A download left waiting when the app last closed never resumes.
      fs.rmSync(path.join(root, DOWNLOAD_STAGING), { recursive: true, force: true });
      configureBrowserSession(ses, { protectedPorts: () => [this.deps.serverPort(), this.bridge?.port ?? 0].filter(Boolean) });
      ses.on('will-download', (_event, item, contents) => this.placeDownload(root, item, this.owners.get(contents)));
    }
    this.profile = { root, session: ses };
    return ses;
  }

  /* Downloads land in the account's folder inside Downloads. While the person
     holds the browser they save at once, as the person's own; otherwise (the
     agent holds it, or the page is no task's) each one waits, paused and
     staged outside Downloads, for the person's yes in the pane. Public for
     tests; the profile's will-download handler calls it. */
  placeDownload(root: string, item: DownloadItem, hooks: TabHooks | undefined): void {
    const folder = accountDownloadsFolder(this.deps.downloadsDir(), root);
    const folderName = path.basename(folder);
    const id = randomBytes(6).toString('hex');
    const suggested = item.getFilename();
    const staging = path.join(root, DOWNLOAD_STAGING);
    try {
      fs.mkdirSync(hooks?.personHolds() ? folder : staging, { recursive: true, mode: 0o700 });
    } catch (error) {
      // Nowhere to put it: nothing downloads, rather than landing loose.
      diagnostic('main.browser-host', 'WARNING', 'browser_host_could_not_place_a_download', error);
      item.cancel();
      hooks?.download({ id, name: path.basename(suggested) || 'download', folder: folderName, state: 'interrupted' });
      return;
    }
    if (hooks?.personHolds()) {
      const target = uniqueDownloadPath(folder, suggested);
      const name = path.basename(target);
      item.setSavePath(target);
      hooks.download({ id, name, folder: folderName, state: 'progressing' });
      item.once('done', (_e, state) => hooks.download({ id, name, folder: folderName, state }));
      return;
    }
    const staged = path.join(staging, `${id}.part`);
    const name = path.basename(uniqueDownloadPath(folder, suggested));
    item.setSavePath(staged);
    item.pause();
    const waiting: WaitingDownload = { sessionId: hooks?.sessionId() ?? null, item, hooks, name, folder, staged, save: null, finished: false };
    this.waitingDownloads.set(id, waiting);
    hooks?.download({ id, name, folder: folderName, state: 'waiting' });
    item.once('done', (_e, state) => {
      if (state === 'completed' && waiting.save === null) {
        waiting.finished = true;
        return;
      }
      this.settleDownload(id, state === 'completed' ? 'completed' : state);
    });
  }

  /* A waiting download's end: moved into Downloads when the person said yes
     and it completed, else deleted from staging. */
  private settleDownload(id: string, state: BrowserDownload['state']): void {
    const waiting = this.waitingDownloads.get(id);
    if (!waiting) return;
    this.waitingDownloads.delete(id);
    const folderName = path.basename(waiting.folder);
    let { name } = waiting;
    let final: BrowserDownload['state'] = waiting.save === true && state === 'completed' ? 'completed' : state === 'completed' ? 'cancelled' : state;
    try {
      if (final === 'completed') {
        fs.mkdirSync(waiting.folder, { recursive: true });
        const target = uniqueDownloadPath(waiting.folder, name);
        moveFile(waiting.staged, target);
        name = path.basename(target);
      } else {
        fs.rmSync(waiting.staged, { force: true });
      }
    } catch (error) {
      diagnostic('main.browser-host', 'WARNING', 'browser_host_could_not_place_a_download', error);
      fs.rmSync(waiting.staged, { force: true });
      final = 'interrupted';
    }
    waiting.hooks?.download({ id, name, folder: folderName, state: final });
  }

  /** The person's answer, in one task's pane, to that task's waiting download. */
  answerDownload(sessionId: string, id: string, save: boolean): void {
    const waiting = this.waitingDownloads.get(id);
    if (!waiting || waiting.save !== null || waiting.sessionId !== sessionId) return;
    waiting.save = save;
    if (!save) {
      if (waiting.finished) this.settleDownload(id, 'cancelled');
      else waiting.item.cancel();
      return;
    }
    if (waiting.finished) {
      this.settleDownload(id, 'completed');
      return;
    }
    waiting.hooks?.download({ id, name: waiting.name, folder: path.basename(waiting.folder), state: 'progressing' });
    waiting.item.resume();
  }

  private dropWaitingDownloads(sessionId: string): void {
    for (const [id, waiting] of [...this.waitingDownloads]) {
      if (waiting.sessionId !== sessionId || waiting.save !== null) continue;
      this.answerDownload(sessionId, id, false);
    }
  }

  private async cookiesFor(site: string): Promise<{ present: boolean; expiresAt: string | null }> {
    const cookies = await this.profileSession().cookies.get({ domain: site });
    const now = Date.now() / 1000;
    const live = cookies.filter((c) => c.expirationDate === undefined || c.expirationDate > now);
    const expiries = live.map((c) => c.expirationDate).filter((d): d is number => d !== undefined);
    return {
      present: live.length > 0,
      expiresAt: expiries.length ? new Date(Math.max(...expiries) * 1000).toISOString() : null,
    };
  }

  /** Sign out of all sites: every task closes, and the profile's cookies, storage and cache go. */
  async clearData(): Promise<{ ok: boolean }> {
    this.sessions.closeAll();
    try {
      const ses = this.profileSession();
      await ses.clearStorageData();
      await ses.clearCache();
      await ses.clearAuthCache();
      BrowserStore.forAccountRoot(this.deps.accountRoot()).forgetSites();
      return { ok: true };
    } catch (error) {
      diagnostic('main.browser-host', 'WARNING', 'browser_host_could_not_clear_the_browser_data', error);
      return { ok: false };
    }
  }

  // ---- Registration ----------------------------------------------------------------

  private address(): { url: string; token: string } | null {
    if (!this.supported()) return null;
    return this.bridge && this.window && this.rendererReady ? { url: this.bridge.url, token: this.token } : null;
  }

  /* A change of account or stores closes every task, makes a new key and
     moves to the new account's profile. The stores are known only while the
     server runs or starts; a stopped server is not a switch. */
  private syncAccount(): void {
    const stores = this.deps.storesRoot();
    if (stores === null) return;
    const identity = `${this.deps.accountRoot()}\u0000${stores}`;
    if (this.identity === identity) return;
    const first = this.identity === null;
    this.identity = identity;
    if (first) return;
    this.sessions.closeAll();
    this.token = newBridgeToken();
  }

  /** The started hook's browser step: after every server start or adoption. */
  async serverStarted(): Promise<boolean> {
    this.syncAccount();
    const address = this.address();
    return address ? this.registration.push(address) : false;
  }

  /** The UI can show the in-app browser. */
  async rendererIsReady(): Promise<boolean> {
    this.rendererReady = true;
    this.syncAccount();
    const address = this.address();
    return address ? this.registration.push(address) : false;
  }

  attachWindow(window: BrowserWindow): void {
    this.window = window;
    this.rendererReady = false;
    this.sessions.setAvailable(true);
    window.on('closed', () => this.detachWindow(window));
    window.webContents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      // The UI is reloading: it shows nothing until it says it's ready again.
      this.sessions.hide();
      if (this.rendererReady) {
        this.rendererReady = false;
        void this.registration.push(null);
      }
    });
  }

  detachWindow(window: BrowserWindow): void {
    if (this.window !== window) return;
    this.window = null;
    this.rendererReady = false;
    this.sessions.setAvailable(false);
    void this.registration.push(null);
  }

  // ---- The pane --------------------------------------------------------------------

  private sendState(state: BrowserViewState): void {
    // A task that closes takes its waiting downloads with it.
    if (!state.open) this.dropWaitingDownloads(state.sessionId);
    const window = this.window;
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(IPC.BROWSER_STATE, state);
  }

  /* The renderer measures in CSS pixels; the window places views in DIP. */
  private toViewBounds(bounds: StageBounds): ViewBounds {
    const zoom = this.window?.webContents.getZoomFactor() ?? 1;
    return {
      x: Math.round(bounds.x * zoom),
      y: Math.round(bounds.y * zoom),
      width: Math.max(1, Math.round(bounds.width * zoom)),
      height: Math.max(1, Math.round(bounds.height * zoom)),
    };
  }

  private fromMainFrame(event: IpcMainInvokeEvent): boolean {
    const window = this.window;
    const allowed = !!window && !window.isDestroyed() && event.senderFrame !== null && event.senderFrame === window.webContents.mainFrame;
    if (!allowed) diagnostic('main.browser-host', 'WARNING', 'browser_host_refused_ipc_from_another_frame');
    return allowed;
  }

  /** Registers the pane's IPC. Every handler answers only the app's main frame. */
  registerIpc(ipc: IpcMain): void {
    // Below the Electron floor the preload exposes no pane, and nothing answers.
    if (!this.supported()) return;
    const handle = (channel: string, run: (...args: unknown[]) => unknown) => {
      ipc.handle(channel, (event, ...args) => {
        if (!this.fromMainFrame(event)) throw new Error('refused');
        return run(...args);
      });
    };
    const sessionArg = (value: unknown): string => {
      if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) throw new Error('bad session id');
      return value;
    };
    const boundsArg = (value: unknown): ViewBounds => {
      const bounds = parseStageBounds(value);
      if (!bounds) throw new Error('bad bounds');
      return this.toViewBounds(bounds);
    };
    handle(IPC.BROWSER_READY, () => this.rendererIsReady().then(() => undefined));
    handle(IPC.BROWSER_SHOW, (id, bounds) => this.sessions.show(sessionArg(id), boundsArg(bounds)));
    handle(IPC.BROWSER_HIDE, () => this.sessions.hide());
    handle(IPC.BROWSER_SET_BOUNDS, (bounds) => this.sessions.setBounds(boundsArg(bounds)));
    handle(IPC.BROWSER_NAVIGATE, (id, where) => {
      if (where !== 'back' && where !== 'forward' && where !== 'reload') throw new Error('bad navigation');
      return this.sessions.personNavigate(sessionArg(id), where);
    });
    handle(IPC.BROWSER_ACTIVATE_TAB, (id, tabId) => {
      if (typeof tabId !== 'string' || !TAB_ID_PATTERN.test(tabId)) throw new Error('bad tab id');
      this.sessions.personActivateTab(sessionArg(id), tabId);
    });
    handle(IPC.BROWSER_TAKE_OVER, (id) => this.sessions.takeOver(sessionArg(id)));
    handle(IPC.BROWSER_HAND_BACK, (id) => this.sessions.handBack(sessionArg(id)));
    handle(IPC.BROWSER_ANSWER_LOGIN, (id, answer) => {
      const parsed = answer === null ? null : parseLoginAnswer(answer);
      if (answer !== null && !parsed) throw new Error('bad answer');
      this.sessions.answerLogin(sessionArg(id), parsed);
    });
    handle(IPC.BROWSER_ANSWER_DOWNLOAD, (id, downloadId, save) => {
      const session = sessionArg(id);
      if (typeof downloadId !== 'string' || !/^[0-9a-f]{12}$/.test(downloadId) || typeof save !== 'boolean') throw new Error('bad answer');
      this.answerDownload(session, downloadId, save);
    });
    handle(IPC.BROWSER_CLEAR_DATA, () => this.clearData());
  }
}
