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
import {
  browserMemoryPartition,
  browserProfilePath,
  configureBrowserSession,
  ensureProfileDir,
  isQuarantinedAccountRoot,
} from './browser-profile';
import { BrowserRegistration } from './browser-register';
import { BrowserSessions, type TabFactory, type TabHooks, type ViewBounds } from './browser-sessions';
import { BrowserStore } from './browser-store';
import { electronTabFactory, type TabContext } from './browser-view';

const IDLE_SWEEP_MS = 60_000;
/* Under the account's data root: downloads that wait for the person's Save. */
const DOWNLOAD_STAGING = 'browser-downloads';
/* The most downloads one task keeps waiting for the person's answer at once.
   A new one past them is cancelled, so a page can't pile up paused
   downloads. */
export const MAX_WAITING_DOWNLOADS = 5;
/* A download's file name stays under the 255-byte limit of common file
   systems, with room for a " (n)". */
const MAX_NAME_BYTES = 200;
const TAB_ID_PATTERN = /^t\d{1,4}$/;

export function newBridgeToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The account's own folder inside the OS Downloads folder: downloads never
    land loose in it. The account on the app's default root gets "Cowork
    browser"; another account's folder adds the start of its id, and a
    launch's quarantine root its whole name, whose random end keeps two such
    roots apart. */
export function accountDownloadsFolder(downloadsDir: string, accountRoot: string): string {
  const parent = path.basename(path.dirname(accountRoot));
  const name = path.basename(accountRoot).replace(/[^A-Za-z0-9_-]/g, '');
  const id = isQuarantinedAccountRoot(accountRoot) ? name : name.slice(0, 12);
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
  /** The task whose pane may answer it. */
  sessionId: string;
  item: DownloadItem;
  hooks: TabHooks;
  name: string;
  folder: string;
  staged: string;
  /** null until the person answers. */
  save: boolean | null;
  /** The item finished before the person answered. */
  finished: boolean;
}

/* The longest start of `text` that fits in `bytes` UTF-8 bytes, cut between
   characters. */
function byteCapped(text: string, bytes: number): string {
  let kept = '';
  let used = 0;
  for (const char of text) {
    used += Buffer.byteLength(char);
    if (used > bytes) break;
    kept += char;
  }
  return kept;
}

/** The save paths of downloads still in flight. Chromium creates a file only
    after a later hop, so the disk alone can't tell two of them apart. Paths
    compare as macOS and Windows compare file names, without case and in one
    Unicode form, so Report.pdf and report.pdf are one path; on a disk that
    tells them apart, that costs only a " (n)". */
export class ReservedPaths {
  private readonly keys = new Set<string>();

  private static key(file: string): string {
    return file.normalize('NFC').toLowerCase();
  }

  add(file: string): void {
    this.keys.add(ReservedPaths.key(file));
  }

  delete(file: string): void {
    this.keys.delete(ReservedPaths.key(file));
  }

  has(file: string): boolean {
    return this.keys.has(ReservedPaths.key(file));
  }
}

/** A file name for a download in `dir` that is safe, at most
    MAX_NAME_BYTES long before any " (n)", and taken neither on disk nor in
    `reserved`. A name too long loses the end of its stem; an extension too
    long to keep is cut with the rest of the name. */
export function uniqueDownloadPath(dir: string, suggested: string, reserved: ReservedPaths = new ReservedPaths()): string {
  const base = path.basename(suggested.replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '').trim() || 'download';
  let ext = path.extname(base);
  if (Buffer.byteLength(ext) >= MAX_NAME_BYTES) ext = '';
  const stem = byteCapped(base.slice(0, base.length - ext.length), MAX_NAME_BYTES - Buffer.byteLength(ext)).trimEnd() || 'download';
  for (let n = 0; ; n += 1) {
    const name = n === 0 ? `${stem}${ext}` : `${stem} (${n})${ext}`;
    const candidate = path.join(dir, name);
    if (!fs.existsSync(candidate) && !reserved.has(candidate)) return candidate;
  }
}

export interface InAppBrowserDeps {
  /** The local server's port, whether or not it runs: pages may never reach it. */
  serverPort(): number;
  /** The port to register with: the local server's while it runs, else null. */
  runningServerPort(): number | null;
  authHeader(): Record<string, string>;
  /** The signed-in account's data root, and the stores the server runs on. */
  accountRoot(): string;
  /** The data root of the account the running or starting sidecar serves,
      or null when none does. The browser follows this account, not the
      signed-in one, so it moves only when the sidecar does. */
  sidecarAccountRoot(): string | null;
  /** The app's userData folder, where the browser profiles live (`app.getPath('userData')`). */
  userDataDir(): string;
  storesRoot(): string | null;
  downloadsDir(): string;
  /** session.fromPath. */
  profileSession(dir: string): Session;
  /** session.fromPartition, for a partition without the `persist:` prefix:
      a session that keeps nothing on disk. */
  memorySession(partition: string): Session;
  /** Marks a file the browser saved into Downloads as downloaded from the
      web. On macOS that is the com.apple.quarantine mark Gatekeeper checks
      before the file opens; the mark carries the web-download flags, the time
      and the agent, not the address. Throws when the mark can't be written. */
  markDownloaded(file: string): void;
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
  /* The account the sidecar served at the last sync. The profile, the cookie
     lookups and the store follow it, so they move only together with the
     tasks and the key. */
  private accountInUse: string | null = null;
  private profile: { root: string; session: Session } | null = null;
  private readonly owners = new WeakMap<WebContents, TabHooks>();
  private readonly waitingDownloads = new Map<string, WaitingDownload>();
  private readonly reservedPaths = new ReservedPaths();
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
      store: () => BrowserStore.forAccountRoot(this.profileRoot()),
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

  /* The account root the browser works for: the one the sidecar served at
     the last sync, else the signed-in one. */
  private profileRoot(): string {
    return this.accountInUse ?? this.deps.accountRoot();
  }

  private profileSession(): Session {
    const root = this.profileRoot();
    if (this.profile?.root === root) return this.profile.session;
    const ses = this.lockedProfile(root);
    this.profile = { root, session: ses };
    return ses;
  }

  /* The root's profile session, locked down the first time it opens. */
  private lockedProfile(root: string): Session {
    const ses = this.openProfile(root);
    if (!this.configured.has(ses)) {
      /* The lockdown runs before the session counts as configured, so a
         lockdown that throws leaves it uncounted and the next call runs it
         again. The staging cleanup comes after, and its failure is only
         logged. */
      configureBrowserSession(ses, { protectedPorts: () => [this.deps.serverPort(), this.bridge?.port ?? 0].filter(Boolean) });
      ses.on('will-download', (_event, item, contents) => this.placeDownload(root, item, this.owners.get(contents)));
      this.configured.add(ses);
      // A download left waiting when the app last closed never resumes.
      try {
        fs.rmSync(path.join(root, DOWNLOAD_STAGING), { recursive: true, force: true });
      } catch (error) {
        diagnostic('main.browser-host', 'WARNING', 'browser_host_could_not_clear_staged_downloads', error);
      }
    }
    return ses;
  }

  /* A quarantine root's profile lives in memory: no later launch names that
     root again, so a folder for it would never be reached, or cleared. */
  private openProfile(root: string): Session {
    if (isQuarantinedAccountRoot(root)) return this.deps.memorySession(browserMemoryPartition(root));
    const dir = browserProfilePath(this.deps.userDataDir(), root);
    ensureProfileDir(dir);
    return this.deps.profileSession(dir);
  }

  /* Marks a file saved into Downloads as downloaded from the web, so macOS
     checks it before it opens. A file that can't be marked is removed rather
     than left in Downloads unmarked, and its download reads as interrupted. */
  private markSaved(file: string): 'completed' | 'interrupted' {
    try {
      this.deps.markDownloaded(file);
      return 'completed';
    } catch (error) {
      diagnostic('main.browser-host', 'WARNING', 'browser_host_could_not_mark_a_download', error);
    }
    try {
      fs.rmSync(file, { force: true });
    } catch (error) {
      diagnostic('main.browser-host', 'WARNING', 'browser_host_could_not_remove_an_unmarked_download', error);
    }
    return 'interrupted';
  }

  private waitingCount(sessionId: string): number {
    return [...this.waitingDownloads.values()].filter((waiting) => waiting.sessionId === sessionId && waiting.save === null).length;
  }

  /* Downloads land in the account's folder inside Downloads. While the person
     holds the browser they save at once, as the person's own; while the agent
     holds it each one waits, paused and staged outside Downloads, for the
     person's yes in the pane, and one past MAX_WAITING_DOWNLOADS is
     cancelled. A download no task owns is cancelled, since no pane can ask
     about it. Public for tests; the profile's will-download handler calls
     it. */
  placeDownload(root: string, item: DownloadItem, hooks: TabHooks | undefined): void {
    if (!hooks) {
      diagnostic('main.browser-host', 'WARNING', 'browser_host_cancelled_a_download_no_task_owns');
      item.cancel();
      return;
    }
    const folder = accountDownloadsFolder(this.deps.downloadsDir(), root);
    const folderName = path.basename(folder);
    const id = randomBytes(6).toString('hex');
    const suggested = item.getFilename();
    const staging = path.join(root, DOWNLOAD_STAGING);
    const personHolds = hooks.personHolds();
    const refuse = (state: BrowserDownload['state']): void => {
      item.cancel();
      hooks.download({ id, name: path.basename(suggested) || 'download', folder: folderName, state });
    };
    if (!personHolds && this.waitingCount(hooks.sessionId()) >= MAX_WAITING_DOWNLOADS) {
      refuse('cancelled');
      return;
    }
    try {
      fs.mkdirSync(personHolds ? folder : staging, { recursive: true, mode: 0o700 });
    } catch (error) {
      // Nowhere to put it: nothing downloads, rather than landing loose.
      diagnostic('main.browser-host', 'WARNING', 'browser_host_could_not_place_a_download', error);
      refuse('interrupted');
      return;
    }
    if (personHolds) {
      const target = uniqueDownloadPath(folder, suggested, this.reservedPaths);
      const name = path.basename(target);
      this.reservedPaths.add(target);
      item.setSavePath(target);
      hooks.download({ id, name, folder: folderName, state: 'progressing' });
      item.once('done', (_e, state) => {
        this.reservedPaths.delete(target);
        hooks.download({ id, name, folder: folderName, state: state === 'completed' ? this.markSaved(target) : state });
      });
      return;
    }
    const staged = path.join(staging, `${id}.part`);
    const name = path.basename(uniqueDownloadPath(folder, suggested, this.reservedPaths));
    item.setSavePath(staged);
    item.pause();
    const waiting: WaitingDownload = { sessionId: hooks.sessionId(), item, hooks, name, folder, staged, save: null, finished: false };
    this.waitingDownloads.set(id, waiting);
    hooks.download({ id, name, folder: folderName, state: 'waiting' });
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
        /* The name skips the paths of downloads in flight. The move is
           synchronous, so from then on the file on disk holds its name. */
        const target = uniqueDownloadPath(waiting.folder, name, this.reservedPaths);
        moveFile(waiting.staged, target);
        name = path.basename(target);
        final = this.markSaved(target);
      } else {
        fs.rmSync(waiting.staged, { force: true });
      }
    } catch (error) {
      diagnostic('main.browser-host', 'WARNING', 'browser_host_could_not_place_a_download', error);
      fs.rmSync(waiting.staged, { force: true });
      final = 'interrupted';
    }
    waiting.hooks.download({ id, name, folder: folderName, state: final });
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
    waiting.hooks.download({ id, name: waiting.name, folder: path.basename(waiting.folder), state: 'progressing' });
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

  /** Sign out of all sites: every task closes, and the profile's cookies,
      storage and cache go, with the sites the store remembers. While a
      sign-in is ahead of the sidecar, the browser still runs on the
      sidecar's account, so the signed-in account's profile is cleared
      too. */
  async clearData(): Promise<{ ok: boolean }> {
    this.sessions.closeAll();
    try {
      for (const root of new Set([this.profileRoot(), this.deps.accountRoot()])) {
        const ses = this.lockedProfile(root);
        await ses.clearStorageData();
        /* The cookie store writes its deletes to disk in batches; a crash
           before the next batch would bring every cookie back. */
        await ses.cookies.flushStore();
        await ses.clearCache();
        await ses.clearAuthCache();
        BrowserStore.forAccountRoot(root).forgetSites();
      }
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

  /* A change of the sidecar's account or stores closes every task, makes a
     new key and moves to that account's profile. The stores are known only
     while the server runs or starts; a stopped server is not a switch, and
     neither is a sign-in the sidecar hasn't moved to yet. */
  private syncAccount(): void {
    const stores = this.deps.storesRoot();
    if (stores === null) return;
    const account = this.deps.sidecarAccountRoot() ?? this.deps.accountRoot();
    const identity = `${account}\u0000${stores}`;
    if (this.identity === identity) return;
    const first = this.identity === null;
    this.identity = identity;
    this.accountInUse = account;
    if (first) return;
    this.sessions.closeAll();
    this.token = newBridgeToken();
  }

  /** The started hook's browser step: after every server start or adoption. */
  async serverStarted(): Promise<boolean> {
    this.syncAccount();
    return this.register();
  }

  /** The UI can show the in-app browser. */
  async rendererIsReady(): Promise<boolean> {
    this.rendererReady = true;
    this.syncAccount();
    return this.register();
  }

  /* Pushes the address and key, if there is one to push. Once the server
     takes it, the UI hears so and asks GET /browse/status again, since the
     server offers the browser only from then on, and an answer the UI got
     before can say it doesn't. */
  private async register(): Promise<boolean> {
    const address = this.address();
    if (!address) return false;
    const taken = await this.registration.push(address);
    if (taken) {
      const window = this.window;
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC.BROWSER_REGISTERED);
    }
    return taken;
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
