/*
 * The in-app browser's tasks: one session per task (session id t-<hash>),
 * each with its own tabs, active tab, control record and one-at-a-time queue
 * for the agent's calls. All sessions share the account's profile, so sign-ins
 * are shared and tabs are per task, as on the web.
 *
 * Control binds the agent here, in the host. While the person holds a task's
 * browser, every page, action, screenshot and tab call gets 409
 * human_in_control, and a step already running is cut off, so the debugger is
 * never attached during the person's turn. The API only hands the browser to
 * the person; only the person hands it back, with Done in the pane (over IPC
 * from the app's main frame), which records holder agent by person.
 *
 * At most MAX_LIVE_SESSIONS tasks stay live: opening another closes the least
 * recently used one. A task idle for IDLE_CLOSE_MS closes too. Neither ever
 * closes the task the pane shows or one the person holds. Closing a task closes
 * its tabs; the profile and its sign-ins stay.
 */

import {
  BridgeError,
  type BrowserDownload,
  type BrowserLoginAnswer,
  type BrowserViewState,
  type Control,
  type ControlRequest,
  type PageSnapshot,
  type SessionInfo,
  type Site,
  type StepRequest,
  type Tab,
} from '../shared/browser-contract';
import { refusedDestination } from './browser-profile';
import type { Screenshot } from './browser-screenshot';

export const MAX_LIVE_SESSIONS = 6;
export const IDLE_CLOSE_MS = 15 * 60_000;
/** A popup opens only within this long of an agent step or the person's own input. */
export const POPUP_INPUT_WINDOW_MS = 1_000;
const MAX_TABS = 20;
const MAX_DOWNLOADS = 5;

/** A rectangle in the window's own coordinates (DIP). */
export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* Where a task's tabs are laid out while the pane doesn't show them. */
const DEFAULT_BOUNDS: ViewBounds = { x: 0, y: 0, width: 900, height: 800 };

/** One tab: a native view the host drives. browser-view.ts implements it. */
export interface TabView {
  url(): string;
  title(): string;
  loading(): boolean;
  canGoBack(): boolean;
  canGoForward(): boolean;
  read(maxText: number): Promise<PageSnapshot>;
  act(request: StepRequest): Promise<void>;
  screenshot(annotate: boolean, quality: number): Promise<Screenshot>;
  load(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  /** On screen at `bounds`. */
  show(bounds: ViewBounds): void;
  /** Off screen but laid out at `bounds`, so the agent can still use it. */
  park(bounds: ViewBounds): void;
  /** Ends a step in flight: detaches the debugger at once. */
  abortInput(): void;
  close(): void;
}

export interface LoginRequest {
  host: string;
  respond(answer: BrowserLoginAnswer | null): void;
}

/** What a tab tells its session. */
export interface TabHooks {
  changed(): void;
  personInput(): void;
  popupAllowed(): boolean;
  adopt(tab: TabView): void;
  login(request: LoginRequest): void;
  download(download: BrowserDownload): void;
  /** Whether the person took the browser themselves (Take over), not one the
      agent or a page's sign-in prompt handed them: only then do downloads
      save without asking. */
  personHolds(): boolean;
  /** The task this tab belongs to. */
  sessionId(): string;
}

export interface TabFactory {
  create(hooks: TabHooks, url: string | null): TabView;
}

export interface CookieInfo {
  present: boolean;
  expiresAt: string | null;
}

export interface BrowserSessionsOptions {
  factory: TabFactory;
  emit(state: BrowserViewState): void;
  cookies(site: string): Promise<CookieInfo>;
  now?: () => number;
  maxLive?: number;
  idleMs?: number;
}

interface TabEntry {
  id: string;
  view: TabView;
}

interface TaskSession {
  id: string;
  tabs: TabEntry[];
  activeTabId: string;
  nextTab: number;
  control: Control;
  queue: Promise<unknown>;
  stepRunning: boolean;
  createdAt: number;
  lastUsed: number;
  lastAgentStepAt: number;
  lastPersonInputAt: number;
  login: LoginRequest | null;
  downloads: BrowserDownload[];
}

const unavailable = () => new BridgeError('browser_unavailable', "the app's window is closed");

/* An address the agent asks for that the page request filter would cancel
   (MindsHub's own hosts, link-local addresses) gets a 400 that says why. */
function refuseDestination(url: string | null): void {
  const refused = url ? refusedDestination(url) : null;
  if (refused) throw new BridgeError('bad_request', refused);
}

/* A tab's address for the API: null before a page loads. */
function pageUrl(view: TabView): string | null {
  const url = view.url();
  return url && url !== 'about:blank' ? url : null;
}

export class BrowserSessions {
  private readonly sessions = new Map<string, TaskSession>();
  private readonly now: () => number;
  private readonly maxLive: number;
  private readonly idleMs: number;
  private available = false;
  private shownId: string | null = null;
  private bounds: ViewBounds | null = null;

  constructor(private readonly options: BrowserSessionsOptions) {
    this.now = options.now ?? Date.now;
    this.maxLive = options.maxLive ?? MAX_LIVE_SESSIONS;
    this.idleMs = options.idleMs ?? IDLE_CLOSE_MS;
  }

  // ---- Lifecycle ---------------------------------------------------------------

  /** Whether the app's window exists. Without it every call answers 503 and every task closes. */
  setAvailable(available: boolean): void {
    this.available = available;
    if (!available) this.closeAll();
  }

  isAvailable(): boolean {
    return this.available;
  }

  liveIds(): string[] {
    return [...this.sessions.keys()];
  }

  private requireAvailable(): void {
    if (!this.available) throw unavailable();
  }

  private evictable(session: TaskSession): boolean {
    return session.id !== this.shownId && session.control.holder !== 'human';
  }

  private create(id: string, url: string | null): TaskSession {
    while (this.sessions.size >= this.maxLive) {
      const oldest = [...this.sessions.values()].filter((s) => this.evictable(s)).sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!oldest) break;
      this.closeSession(oldest);
    }
    const now = this.now();
    const session: TaskSession = {
      id,
      tabs: [],
      activeTabId: '',
      nextTab: 1,
      control: { holder: 'agent', reason: '', since: now, seq: 0, by: 'agent' },
      queue: Promise.resolve(),
      stepRunning: false,
      createdAt: now,
      lastUsed: now,
      lastAgentStepAt: 0,
      lastPersonInputAt: 0,
      login: null,
      downloads: [],
    };
    this.sessions.set(id, session);
    const tab = this.addTab(session, url);
    session.activeTabId = tab.id;
    this.place(session);
    return session;
  }

  private addTab(session: TaskSession, url: string | null, adopted?: TabView): TabEntry {
    if (session.tabs.length >= MAX_TABS) throw new BridgeError('bad_request', `a task can have at most ${MAX_TABS} tabs`);
    const entry: TabEntry = { id: `t${session.nextTab}`, view: adopted ?? this.options.factory.create(this.hooksFor(session), url) };
    session.nextTab += 1;
    session.tabs.push(entry);
    return entry;
  }

  private hooksFor(session: TaskSession): TabHooks {
    return {
      changed: () => this.emitState(session),
      personInput: () => {
        session.lastPersonInputAt = this.now();
      },
      popupAllowed: () => {
        if (!this.sessions.has(session.id)) return false;
        const recent = Math.max(session.lastAgentStepAt, session.lastPersonInputAt);
        return session.stepRunning || this.now() - recent <= POPUP_INPUT_WINDOW_MS;
      },
      adopt: (view) => {
        if (!this.sessions.has(session.id) || session.tabs.length >= MAX_TABS) {
          view.close();
          return;
        }
        const entry = this.addTab(session, null, view);
        /* While the agent holds the browser a popup opens in the background,
           so a page can't swap the tab the person is looking at. */
        if (session.control.holder === 'human') this.activate(session, entry.id);
        else entry.view.park(this.bounds ?? DEFAULT_BOUNDS);
        this.emitState(session);
      },
      login: (request) => {
        session.login?.respond(null);
        session.login = request;
        this.setControl(session, 'human', `${request.host} asks for a username and password.`, 'agent');
      },
      download: (download) => {
        session.downloads = [download, ...session.downloads.filter((d) => d.id !== download.id)].slice(0, MAX_DOWNLOADS);
        this.emitState(session);
      },
      personHolds: () => session.control.holder === 'human' && session.control.by === 'person',
      sessionId: () => session.id,
    };
  }

  private closeSession(session: TaskSession): void {
    this.sessions.delete(session.id);
    session.login?.respond(null);
    for (const tab of session.tabs) tab.view.close();
    if (this.shownId === session.id) this.shownId = null;
    this.options.emit(this.closedState(session.id));
  }

  /** Closes every task's tabs: window close, account switch, sign-out, Sign out of all sites. */
  closeAll(): void {
    for (const session of [...this.sessions.values()]) this.closeSession(session);
  }

  /** Closes tasks idle past the limit, except the shown one and any the person holds. */
  sweepIdle(): void {
    const now = this.now();
    for (const session of [...this.sessions.values()]) {
      if (this.evictable(session) && now - session.lastUsed > this.idleMs) this.closeSession(session);
    }
  }

  // ---- The agent's API -------------------------------------------------------

  /** POST /sessions: create or return, with the active tab's address (null
      before a page loads). */
  open(id: string, url: string | null): { created: boolean; url: string | null } {
    this.requireAvailable();
    refuseDestination(url);
    const existing = this.sessions.get(id);
    if (existing) {
      existing.lastUsed = this.now();
      return { created: false, url: pageUrl(this.active(existing).view) };
    }
    const session = this.create(id, url);
    return { created: true, url: pageUrl(this.active(session).view) };
  }

  /** A task's session, opened again with a blank tab if the host closed it. */
  private ensure(id: string): TaskSession {
    this.requireAvailable();
    const session = this.sessions.get(id) ?? this.create(id, null);
    session.lastUsed = this.now();
    return session;
  }

  private agentHolds(session: TaskSession): void {
    if (session.control.holder === 'human') {
      const why = session.control.reason ? ` (${session.control.reason})` : '';
      throw new BridgeError('human_in_control', `The person is using the browser${why}.`);
    }
  }

  /* The agent's calls on one task run one at a time, and each checks control
     when its turn comes, not when it was asked. */
  private enqueue<T>(session: TaskSession, run: () => Promise<T>): Promise<T> {
    const next = session.queue.then(async () => {
      if (!this.sessions.has(session.id)) throw new BridgeError('not_found', 'this task\'s browser was closed');
      this.agentHolds(session);
      session.lastUsed = this.now();
      return run();
    });
    session.queue = next.catch(() => undefined);
    return next;
  }

  private active(session: TaskSession): TabEntry {
    const tab = session.tabs.find((t) => t.id === session.activeTabId);
    if (!tab) throw new BridgeError('internal', 'the task has no active tab');
    return tab;
  }

  /** GET /sessions/{id}. Answers while the person holds control. */
  info(id: string): SessionInfo {
    this.requireAvailable();
    const session = this.sessions.get(id);
    if (!session) throw new BridgeError('not_found', `no browser is open for ${id}`);
    return {
      session_id: id,
      running: true,
      url: pageUrl(this.active(session).view),
      title: this.active(session).view.title(),
      viewers: this.shownId === id ? 1 : 0,
      control: { ...session.control },
      created_at: new Date(session.createdAt).toISOString(),
      last_active_at: new Date(session.lastUsed).toISOString(),
    };
  }

  page(id: string, maxText: number): Promise<PageSnapshot> {
    const session = this.ensure(id);
    return this.enqueue(session, () => this.active(session).view.read(maxText));
  }

  action(id: string, request: StepRequest): Promise<{ ok: true; url: string; page?: PageSnapshot }> {
    const session = this.ensure(id);
    return this.enqueue(session, async () => {
      const tab = this.active(session);
      session.stepRunning = true;
      try {
        await tab.view.act(request);
      } finally {
        session.stepRunning = false;
        session.lastAgentStepAt = this.now();
      }
      this.emitState(session);
      const current = this.active(session);
      const answer: { ok: true; url: string; page?: PageSnapshot } = { ok: true, url: current.view.url() };
      if (request.includePage) answer.page = await current.view.read(3000);
      return answer;
    });
  }

  screenshot(id: string, annotate: boolean, quality: number): Promise<Screenshot> {
    const session = this.ensure(id);
    return this.enqueue(session, () => this.active(session).view.screenshot(annotate, quality));
  }

  /** POST /sessions/{id}/control: the agent hands the browser to the person. */
  control(id: string, request: ControlRequest): Control {
    const session = this.ensure(id);
    return this.setControl(session, request.holder, request.reason, 'agent');
  }

  private setControl(session: TaskSession, holder: Control['holder'], reason: string, by: Control['by']): Control {
    if (holder === 'human') {
      for (const tab of session.tabs) tab.view.abortInput();
    }
    session.control = { holder, reason, since: this.now(), seq: session.control.seq + 1, by };
    this.emitState(session);
    return { ...session.control };
  }

  private tabOf(entry: TabEntry, session: TaskSession): Tab {
    return { id: entry.id, url: entry.view.url(), title: entry.view.title(), active: entry.id === session.activeTabId };
  }

  tabs(id: string): Promise<Tab[]> {
    const session = this.ensure(id);
    return this.enqueue(session, async () => session.tabs.map((t) => this.tabOf(t, session)));
  }

  newTab(id: string, url: string | null): Promise<Tab> {
    refuseDestination(url);
    const session = this.ensure(id);
    return this.enqueue(session, async () => {
      const entry = this.addTab(session, url);
      this.activate(session, entry.id);
      return this.tabOf(entry, session);
    });
  }

  activateTab(id: string, tabId: string): Promise<Tab> {
    const session = this.ensure(id);
    return this.enqueue(session, async () => {
      const entry = session.tabs.find((t) => t.id === tabId);
      if (!entry) throw new BridgeError('tab_not_found', `no tab ${tabId}`);
      this.activate(session, tabId);
      return this.tabOf(entry, session);
    });
  }

  /** Closing the last tab leaves a blank one. */
  closeTab(id: string, tabId: string): Promise<void> {
    const session = this.ensure(id);
    return this.enqueue(session, async () => {
      const entry = session.tabs.find((t) => t.id === tabId);
      if (!entry) throw new BridgeError('tab_not_found', `no tab ${tabId}`);
      session.tabs = session.tabs.filter((t) => t !== entry);
      entry.view.close();
      if (!session.tabs.length) this.addTab(session, null);
      if (session.activeTabId === tabId || !session.tabs.some((t) => t.id === session.activeTabId)) {
        this.activate(session, session.tabs[session.tabs.length - 1].id);
      } else {
        this.emitState(session);
      }
    });
  }

  /** The sites on record, with whether this profile still holds a cookie for each. */
  async sites(id: string, records: Array<{ site: string; account_hint: string; noted_at: string }>): Promise<Site[]> {
    this.ensure(id);
    return Promise.all(records.map(async (record) => {
      const cookies = await this.options.cookies(record.site);
      return { ...record, cookies_present: cookies.present, cookies_expire_at: cookies.expiresAt };
    }));
  }

  /** DELETE /sessions/{id}. */
  close(id: string): void {
    this.requireAvailable();
    const session = this.sessions.get(id);
    if (session) this.closeSession(session);
  }

  // ---- The pane (the person) -------------------------------------------------

  private activate(session: TaskSession, tabId: string): void {
    session.activeTabId = tabId;
    this.place(session);
    this.emitState(session);
  }

  /* Shows the task's active tab when the pane shows the task, and lays every
     other tab out off screen. */
  private place(session: TaskSession): void {
    const bounds = this.bounds ?? DEFAULT_BOUNDS;
    for (const tab of session.tabs) {
      if (session.id === this.shownId && tab.id === session.activeTabId) tab.view.show(bounds);
      else tab.view.park(bounds);
    }
  }

  /** The pane shows a task's browser at `bounds`. */
  show(id: string, bounds: ViewBounds): { exists: boolean } {
    const session = this.available ? this.sessions.get(id) : undefined;
    const previous = this.shownId ? this.sessions.get(this.shownId) : undefined;
    this.shownId = session ? id : null;
    this.bounds = bounds;
    if (previous && previous !== session) this.place(previous);
    if (!session) return { exists: false };
    session.lastUsed = this.now();
    this.place(session);
    this.emitState(session);
    return { exists: true };
  }

  setBounds(bounds: ViewBounds): void {
    this.bounds = bounds;
    const session = this.shownId ? this.sessions.get(this.shownId) : undefined;
    if (session) this.place(session);
  }

  hide(): void {
    const session = this.shownId ? this.sessions.get(this.shownId) : undefined;
    this.shownId = null;
    if (session) this.place(session);
  }

  private person(id: string): TaskSession | null {
    return this.available ? this.sessions.get(id) ?? null : null;
  }

  async personNavigate(id: string, where: 'back' | 'forward' | 'reload'): Promise<void> {
    const session = this.person(id);
    if (!session) return;
    session.lastPersonInputAt = this.now();
    const view = this.active(session).view;
    await (where === 'back' ? view.back() : where === 'forward' ? view.forward() : view.reload());
  }

  personActivateTab(id: string, tabId: string): void {
    const session = this.person(id);
    if (session && session.tabs.some((t) => t.id === tabId)) this.activate(session, tabId);
  }

  /** Take over: the person holds the browser until they click Done. */
  takeOver(id: string): void {
    const session = this.person(id);
    if (session && session.control.holder !== 'human') this.setControl(session, 'human', '', 'person');
  }

  /** Done: the only way the browser goes back to the agent. */
  handBack(id: string): void {
    const session = this.person(id);
    if (!session || session.control.holder !== 'human') return;
    session.login?.respond(null);
    session.login = null;
    this.setControl(session, 'agent', '', 'person');
  }

  /** The person's answer to a site's sign-in prompt. The values go only to the page's request. */
  answerLogin(id: string, answer: BrowserLoginAnswer | null): void {
    const session = this.person(id);
    if (!session?.login) return;
    session.login.respond(answer);
    session.login = null;
    this.emitState(session);
  }

  // ---- State -----------------------------------------------------------------

  stateOf(id: string): BrowserViewState | null {
    const session = this.sessions.get(id);
    return session ? this.viewState(session) : null;
  }

  private viewState(session: TaskSession): BrowserViewState {
    const view = this.active(session).view;
    return {
      sessionId: session.id,
      open: true,
      url: view.url(),
      title: view.title(),
      loading: view.loading(),
      canGoBack: view.canGoBack(),
      canGoForward: view.canGoForward(),
      tabs: session.tabs.map((t) => this.tabOf(t, session)),
      control: { ...session.control },
      login: session.login ? { host: session.login.host } : null,
      downloads: [...session.downloads],
    };
  }

  private closedState(sessionId: string): BrowserViewState {
    return {
      sessionId,
      open: false,
      url: '',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      tabs: [],
      control: { holder: 'agent', reason: '', since: this.now(), seq: 0, by: 'agent' },
      login: null,
      downloads: [],
    };
  }

  private emitState(session: TaskSession): void {
    if (!this.sessions.has(session.id) || !session.tabs.some((t) => t.id === session.activeTabId)) return;
    this.options.emit(this.viewState(session));
  }
}
