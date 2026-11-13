/*
 * The in-app browser's tasks: one session per task (session id t-<hash>),
 * each with its own tabs, active tab, control record and one-at-a-time queue
 * for the agent's calls. All sessions share the account's profile, so sign-ins
 * are shared and tabs are per task, as on the web.
 *
 * Control binds the agent here, in the host. While the person holds a task's
 * browser, every page, action, screenshot, tab and close call gets 409
 * human_in_control, and a step already running is cut off, so the debugger is
 * never attached during the person's turn. A step that ends during the
 * person's turn answers without the page, and a page read or screenshot that
 * control changed under answers 409. The API only hands the browser to the
 * person; only the person hands it back, with Done in the pane (over IPC from
 * the app's main frame), which records holder agent by person.
 *
 * At most MAX_LIVE_SESSIONS tasks stay live: opening another closes the least
 * recently used one, and the person's own use counts as use. A task idle for
 * IDLE_CLOSE_MS closes too. Neither ever closes the task the pane shows, even
 * while something covers the pane, or one the person holds; when those are
 * all the live tasks, another answers 503 at_capacity. Closing a task closes
 * its tabs; the profile and its sign-ins stay.
 */

import {
  type ActionAnswer,
  BridgeError,
  type BrowserDownload,
  type BrowserLoginAnswer,
  type BrowserViewState,
  type Control,
  type ControlRequest,
  type PageSnapshot,
  type PaneDrawAnswer,
  type PaneShowAnswer,
  type SessionInfo,
  type Site,
  type StepAction,
  type StepRequest,
  type Tab,
  type WaitFor,
} from '../shared/browser-contract';
import { diagnostic } from '../shared/diagnostics';
import { type HandOverWatch, WATCH_TICK_MS, watchTick } from './browser-handover-watch';
import { refusedDestination } from './browser-profile';
import type { Screenshot } from './browser-screenshot';

export const MAX_LIVE_SESSIONS = 6;
export const IDLE_CLOSE_MS = 15 * 60_000;
/** A popup opens only within this long of an agent step or the person's own input. */
export const POPUP_INPUT_WINDOW_MS = 1_000;
export const MAX_TABS = 20;
const MAX_DOWNLOADS = 5;

/* The agent's input steps: a popup may open while one of these runs. */
const INPUT_STEPS: ReadonlySet<StepAction> = new Set<StepAction>(['click', 'press', 'type', 'drag', 'hover', 'scroll']);

/** A rectangle in the window's own coordinates (DIP). */
export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* Where a task's tabs are laid out while the pane doesn't show them. */
const DEFAULT_BOUNDS: ViewBounds = { x: 0, y: 0, width: 900, height: 800 };

/** Bounds under this in either direction are a stage too small to draw a
    page in: the empty rectangle the pane reports while something covers it,
    or a stage that rows above it squeezed. The shown task's tab then parks at
    the last bounds big enough, so its pages keep that layout and the view
    never draws outside the stage, until the stage is big enough again. */
export const MIN_VIEW_PX = 200;

const usable = (bounds: ViewBounds): boolean => bounds.width >= MIN_VIEW_PX && bounds.height >= MIN_VIEW_PX;

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
  /** Marks the page's secret fields, those it has and those it adds later,
      so no read returns their values. Never throws. */
  watchSecrets(): void;
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
  /** Runs `tick` every `ms` until the returned stop is called: the hand-over watch's clock. */
  every?: (tick: () => void, ms: number) => () => void;
}

function every(tick: () => void, ms: number): () => void {
  const timer = setInterval(tick, ms);
  timer.unref?.();
  return () => clearInterval(timer);
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
  /** A hand-over that comes back by itself once the person did what it waits for. */
  watch: HandOverWatch | null;
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

/* The person took the browser themselves (Take over). */
function personTookOver(control: Control): boolean {
  return control.holder === 'human' && control.by === 'person';
}

export class BrowserSessions {
  private readonly sessions = new Map<string, TaskSession>();
  private readonly now: () => number;
  private readonly maxLive: number;
  private readonly idleMs: number;
  private available = false;
  private shownId: string | null = null;
  /* The last bounds big enough to draw in. */
  private bounds: ViewBounds | null = null;
  /* Whether the pane's latest bounds are big enough to draw the shown task.
     The shown task stays the shown one either way, so a covered pane still
     keeps its task from the idle close and the live-task cap. */
  private stageUsable = false;
  /* Stops the hand-over watch's clock, while any task's hand-over is watched. */
  private stopWatching: (() => void) | null = null;

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
      if (!oldest) {
        throw new BridgeError('at_capacity', `at most ${this.maxLive} tasks keep a browser open, and the pane shows or the person holds each one; try again when the person finishes with one`);
      }
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
      watch: null,
    };
    this.sessions.set(id, session);
    // A task whose first tab fails to build is not kept.
    try {
      session.activeTabId = this.addTab(session, url).id;
    } catch (error) {
      this.sessions.delete(id);
      throw error;
    }
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
        session.lastUsed = session.lastPersonInputAt;
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
        // A prompt during the person's own take over leaves the hold theirs.
        const by = personTookOver(session.control) ? 'person' : 'agent';
        this.setControl(session, 'human', `${request.host} asks for a username and password.`, by);
      },
      download: (download) => {
        // The newest few, and every download still waiting for the person's answer.
        const next = [download, ...session.downloads.filter((d) => d.id !== download.id)];
        session.downloads = next.filter((d, i) => i < MAX_DOWNLOADS || d.state === 'waiting');
        this.emitState(session);
      },
      personHolds: () => personTookOver(session.control),
      sessionId: () => session.id,
    };
  }

  private closeSession(session: TaskSession): void {
    this.sessions.delete(session.id);
    session.watch = null;
    this.syncWatchClock();
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

  /* A read that control changed under answers 409, never what it saw: the
     person may have typed or browsed while it ran. */
  private async agentRead<T>(session: TaskSession, read: () => Promise<T>): Promise<T> {
    const seq = session.control.seq;
    const result = await read();
    if (session.control.seq !== seq) throw new BridgeError('human_in_control', 'The browser passed to the person during the read.');
    return result;
  }

  page(id: string, maxText: number): Promise<PageSnapshot> {
    const session = this.ensure(id);
    return this.enqueue(session, () => this.agentRead(session, () => this.active(session).view.read(maxText)));
  }

  action(id: string, request: StepRequest): Promise<ActionAnswer> {
    const session = this.ensure(id);
    return this.enqueue(session, async () => {
      const tab = this.active(session);
      session.stepRunning = INPUT_STEPS.has(request.step.action);
      try {
        await tab.view.act(request);
      } finally {
        session.stepRunning = false;
        session.lastAgentStepAt = this.now();
      }
      this.emitState(session);
      const current = this.active(session);
      const answer: ActionAnswer = { ok: true, url: current.view.url() };
      /* The step ran, so it answers 200 even when the browser passed to the
         person during it or during its read, but without the page. anton then
         asks for the page, and that call gets 409 while the person holds it. */
      if (request.includePage && session.control.holder !== 'human') {
        const seq = session.control.seq;
        const page = await current.view.read(3000);
        if (session.control.seq === seq) answer.page = page;
      }
      return answer;
    });
  }

  screenshot(id: string, annotate: boolean, quality: number): Promise<Screenshot> {
    const session = this.ensure(id);
    return this.enqueue(session, () => this.agentRead(session, () => this.active(session).view.screenshot(annotate, quality)));
  }

  /** POST /sessions/{id}/control: the agent hands the browser to the person,
      with what the hand-over waits for when it comes back by itself. */
  control(id: string, request: ControlRequest): Control {
    const session = this.ensure(id);
    const control = this.setControl(session, request.holder, request.reason, 'agent', request.waitFor);
    if (session.watch) void this.readWatched(session);
    return control;
  }

  /* One read of a watched hand-over's page, in the isolated world, and the
     hand back when it's done. A read that fails, or that control changed
     under, counts for nothing. */
  private async readWatched(session: TaskSession): Promise<void> {
    const watch = session.watch;
    if (!watch || session.login) return;
    let page: PageSnapshot;
    try {
      page = await this.active(session).view.read(0);
    } catch {
      return;
    }
    if (session.watch !== watch || session.control.seq !== watch.seq || !this.sessions.has(session.id)) return;
    if (watchTick(watch, page, { now: this.now(), lastPersonInputAt: session.lastPersonInputAt })) {
      this.setControl(session, 'agent', '', 'person');
    }
  }

  /** One tick of the hand-over watch: every watched task's page is read. */
  async tickWatches(): Promise<void> {
    await Promise.all([...this.sessions.values()].filter((s) => s.watch).map((s) => this.readWatched(s)));
  }

  private syncWatchClock(): void {
    const watching = [...this.sessions.values()].some((s) => s.watch);
    if (watching && !this.stopWatching) {
      this.stopWatching = (this.options.every ?? every)(() => { void this.tickWatches(); }, WATCH_TICK_MS);
    } else if (!watching && this.stopWatching) {
      this.stopWatching();
      this.stopWatching = null;
    }
  }

  /* Control changes before any tab is told, so a tab that fails to stop its
     step or watch its secret fields never leaves the browser with the agent. */
  private setControl(session: TaskSession, holder: Control['holder'], reason: string, by: Control['by'], waitFor?: WaitFor): Control {
    session.control = { holder, reason, since: this.now(), seq: session.control.seq + 1, by };
    // Any change of hands ends a watch; only an agent's hand-over that waits for something starts one.
    session.watch = holder === 'human' && waitFor
      ? { waitFor, seq: session.control.seq, handedAt: this.now(), before: null, lastKey: null }
      : null;
    this.syncWatchClock();
    if (holder === 'human') {
      for (const tab of session.tabs) {
        try {
          tab.view.abortInput();
        } catch (error) {
          diagnostic('main.browser-sessions', 'WARNING', 'browser_sessions_could_not_stop_a_step', error);
        }
        try {
          tab.view.watchSecrets();
        } catch (error) {
          diagnostic('main.browser-sessions', 'WARNING', 'browser_sessions_could_not_watch_secret_fields', error);
        }
      }
    }
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

  /** DELETE /sessions/{id}. Closing is acting, so it waits for the person's Done. */
  close(id: string): void {
    this.requireAvailable();
    const session = this.sessions.get(id);
    if (!session) return;
    this.agentHolds(session);
    this.closeSession(session);
  }

  // ---- The pane (the person) -------------------------------------------------

  private activate(session: TaskSession, tabId: string): void {
    session.activeTabId = tabId;
    this.place(session);
    this.emitState(session);
  }

  /* Shows the task's active tab when the pane shows the task on a stage big
     enough to draw in, and lays every other tab out off screen. Answers
     whether it showed the active tab. */
  private place(session: TaskSession): boolean {
    const bounds = this.bounds ?? DEFAULT_BOUNDS;
    const mayDraw = session.id === this.shownId && this.stageUsable;
    let drawn = false;
    for (const tab of session.tabs) {
      if (mayDraw && tab.id === session.activeTabId) {
        tab.view.show(bounds);
        drawn = true;
      } else {
        tab.view.park(bounds);
      }
    }
    return drawn;
  }

  /* The pane's latest bounds: kept for layout only when big enough to draw in. */
  private takeBounds(bounds: ViewBounds): void {
    this.stageUsable = usable(bounds);
    if (this.stageUsable) this.bounds = bounds;
  }

  /** The pane shows a task's browser at `bounds`. Bounds under MIN_VIEW_PX
      keep the task shown but park its tab. Answers whether the task exists
      and whether its tab draws. */
  show(id: string, bounds: ViewBounds): PaneShowAnswer {
    const session = this.available ? this.sessions.get(id) : undefined;
    const previous = this.shownId ? this.sessions.get(this.shownId) : undefined;
    this.shownId = session ? id : null;
    this.takeBounds(bounds);
    if (previous && previous !== session) {
      previous.lastUsed = this.now();
      this.place(previous);
    }
    if (!session) return { exists: false, drawn: false };
    session.lastUsed = this.now();
    const drawn = this.place(session);
    this.emitState(session);
    return { exists: true, drawn };
  }

  /** The stage moved or resized. Bounds under MIN_VIEW_PX park the shown
      task's tab, and the task stays shown. Answers whether the shown task's
      tab draws; with no task shown, nothing does. */
  setBounds(bounds: ViewBounds): PaneDrawAnswer {
    this.takeBounds(bounds);
    const session = this.shownId ? this.sessions.get(this.shownId) : undefined;
    return { drawn: session ? this.place(session) : false };
  }

  /** The pane stops showing the task. */
  hide(): void {
    const session = this.shownId ? this.sessions.get(this.shownId) : undefined;
    this.shownId = null;
    if (!session) return;
    session.lastUsed = this.now();
    this.place(session);
  }

  /* The task a call from the pane is for. The person's call counts as use. */
  private person(id: string): TaskSession | null {
    const session = this.available ? this.sessions.get(id) ?? null : null;
    if (session) session.lastUsed = this.now();
    return session;
  }

  async personNavigate(id: string, where: 'back' | 'forward' | 'reload'): Promise<void> {
    const session = this.person(id);
    if (!session) return;
    session.lastPersonInputAt = this.now();
    const view = this.active(session).view;
    await (where === 'back' ? view.back() : where === 'forward' ? view.forward() : view.reload());
  }

  /** The person opens an address in a task's browser (typed in the pane): the
      task's session opens at it, or its active tab goes there. `url` null
      opens the session on a blank tab, or leaves an open one be. Refused like
      the agent's for a destination the request filter would cancel. */
  async personOpen(id: string, url: string | null): Promise<void> {
    refuseDestination(url);
    this.requireAvailable();
    const existing = this.sessions.get(id);
    if (!existing) {
      this.create(id, url);
      return;
    }
    if (url === null) return;
    existing.lastUsed = this.now();
    existing.lastPersonInputAt = this.now();
    await this.active(existing).view.load(url);
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
      watching: session.watch !== null,
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
