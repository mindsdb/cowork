/*
 * One tab of the in-app browser: an Electron WebContentsView, a child of the
 * app's window, on the account's browser profile.
 *
 * The pane's tab is placed over the pane's stage; every other tab stays laid
 * out at the stage's size but hidden, so the agent can read and act in it.
 * Page reads run in an isolated world (browser-page-script.ts) and answer
 * 409 page_busy when the page doesn't answer in time. A frame a read reads
 * stays read only where its box, as the page draws it, shows more than one
 * color (`lookAtFrame`). Agent steps attach the
 * debugger for the step only (browser-input.ts). Screenshots are captured
 * without showing a hidden tab, with the page's secret fields and payment
 * frames blacked out (browser-screenshot.ts), those in frames of other sites
 * too, which a screenshot reads through the debugger (browser-frames.ts).
 *
 * Popups become tabs of the same task, keeping window.opener for sign-in
 * flows, and only right after an agent step or the person's own input. A
 * site's sign-in prompt (HTTP authentication) goes to the person in the pane,
 * and a site that asks for a client certificate gets none.
 *
 * When the person takes the browser, a step in flight ends at once: its
 * input stops, and its waits, a navigation's included, answer 409
 * human_in_control.
 *
 * Each step settles before it answers (`act`). A step that started a
 * main-frame request or a navigation, or finds the page aria-busy, waits
 * until those requests are done and the page has gone quiet; one that only
 * changed the page in place waits a moment for quiet at most, and one that
 * did none of these answers SETTLE_QUIET_MS into its settle, so a request
 * it starts by then (a search box's suggestions) is waited for. The step's
 * change watch
 * (browser-page-script.ts) and the profile's request count (RequestsInFlight
 * in browser-profile.ts) say whether it changed what the page shows.
 */

import { type BrowserWindow, type Certificate, type HandlerDetails, type Input, nativeImage, type Session, type WebContents, WebContentsView, type WebFrameMain, type WindowOpenHandlerResponse } from 'electron';
import { diagnostic } from '../shared/diagnostics';
import {
  BridgeError,
  FRAMES_PHASE_MS,
  type PageSnapshot,
  PAYMENT_FRAME_HOSTS,
  SETTLE_MAX_MS,
  SETTLE_QUIET_MS,
  type StepAction,
  type StepOutcome,
  type StepRequest,
  STEP_TIMEOUT_MS,
} from '../shared/browser-contract';
import { FrameReads, withDebugger } from './browser-frames';
import { type AgentInput, type Pacing, type Point, realPacing, runStep, type StepHost, withAgentInput } from './browser-input';
import {
  type Box,
  type ChangeMark,
  challengesFrom,
  type FocusedSecret,
  type FocusFieldResult,
  type FocusResult,
  type FoundSecrets,
  FRAME_READ_RULES,
  type HitTestResult,
  isPaymentAddress,
  type LocateResult,
  PAGE_READ_TIMEOUT_MS,
  PAGE_WORLD_ID,
  pageAnswer,
  pageWorldSource,
  type PageWorldRequest,
  type RawFrame,
  type RawSnapshot,
  screenshotMasks,
  SECRET_SEARCH_DEPTH,
  type SelectResult,
  type TypingFocus,
} from './browser-page-script';
import { browserViewPreferences, guardNavigation, navigationAllowed, refusedDestination, type RequestsInFlight, requestsInFlight } from './browser-profile';
import { frameLook, nearlyOneColor, renderScreenshot, type Screenshot } from './browser-screenshot';
import type { PageReadOptions, TabFactory, TabHooks, TabView, ViewBounds } from './browser-sessions';

/* A navigation the agent asks for answers once the page loads, or after this
   long with the page still loading; anton reads the page either way. It is
   shorter than STEP_TIMEOUT_MS, so a slow load answers 200, not page_blocked. */
export const NAVIGATION_WAIT_MS = 30_000;
const MAX_ELEMENTS = 300;

/** How long a page read's look at one frame's box may take (lookAtFrame);
    a frame whose look takes longer is left unread. */
export const FRAME_LOOK_MS = 1_000;

/* A step's settle: how long it waits before it first looks for what the
   step started (a change, a request or a navigation), how often it then
   reads the page, how long a read of the change watch may take, and how much
   of the step's budget it leaves for the answer. */
const SETTLE_PROBE_MS = 150;
const SETTLE_POLL_MS = 100;
const CHANGE_START_MS = 500;
const CHANGE_MARK_MS = 1_000;
const SETTLE_MARGIN_MS = 500;

/* Steps whose pointer ends somewhere: the change watch checks what lies
   there. */
const POINTER_STEPS: ReadonlySet<StepAction> = new Set<StepAction>(['click', 'hover', 'drag', 'scroll']);

/* One step's settle: its change watch's token, when it began, the address it
   began on, the main-frame navigations since, and when the page's change
   watch last started (in the page the step began on, or the one it reached). */
interface StepWatch {
  token: number;
  startedAt: number;
  url: string;
  navigations: number;
  watchStartedAt: number;
}

function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* A frame as a page read lists it, with nothing the world read there. */
const unread = (frame: RawFrame): RawFrame => ({ url: frame.url, read: false, box: frame.box, at: frame.at, offscreen: frame.offscreen });

const tookOver = () => new BridgeError('human_in_control', 'The person took over the browser.');

/* What Electron's loadURL rejects with: Chromium's error name, and the
   address that failed, which is a redirect's target when the redirect failed. */
interface LoadError {
  code?: string;
  url?: string;
}

/* Whether a key is a Latin letter's key the way the app menu matches its
   shortcuts: by the character it types, or, on a layout without Latin letters
   (Cyrillic, Greek, Hebrew), where that key types another character, by its
   position. */
function isLetterKey(input: Input, letter: string): boolean {
  return input.key.toLowerCase() === letter || (input.code === `Key${letter.toUpperCase()}` && !/^[a-z]$/i.test(input.key));
}

function hostOf(address: string): string | null {
  try {
    return new URL(address).host;
  } catch {
    return null;
  }
}

/* Runs `work` unless `signal` has aborted, and answers 409 human_in_control
   as soon as it does. */
function unlessTakenOver<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(tookOver());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(tookOver());
    signal.addEventListener('abort', abort, { once: true });
    work().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * Where a parked tab sits: the stage's size, above and left of the window
 * with only its bottom-right pixel inside the window's top-left corner.
 * Chromium lays a view out only while it overlaps its window: one hidden with
 * setVisible(false), or placed wholly outside, keeps a zero-sized viewport
 * (or its old size), and the agent can't read or click it. That one pixel
 * sits under the window's rounded corner on macOS.
 */
export function parkedBounds(bounds: ViewBounds): ViewBounds {
  return { x: -(bounds.width - 1), y: -(bounds.height - 1), width: bounds.width, height: bounds.height };
}

/** What every tab needs from the host. */
export interface TabContext {
  /** The app's window, the tabs' parent. */
  window(): BrowserWindow | null;
  /** The account's browser profile session. */
  session(): Session;
  /** Tells the host which tab owns a page, for downloads. */
  register(contents: WebContents, hooks: TabHooks): void;
}

export class ElectronTab implements TabView {
  private readonly view: WebContentsView;
  private mouse: Point | null = null;
  /* The step in flight, which abortInput ends. */
  private step: AbortController | null = null;
  private closed = false;
  /* The settling step's watch, which counts main-frame navigations. */
  private watching: StepWatch | null = null;
  private steps = 0;
  private readonly contentsId: number;
  private readonly requests: RequestsInFlight;

  constructor(private readonly ctx: TabContext, private readonly hooks: TabHooks, url: string | null, adopted?: WebContentsView) {
    this.view = adopted ?? new WebContentsView({ webPreferences: browserViewPreferences(ctx.session()) });
    const contents = this.view.webContents;
    this.contentsId = contents.id;
    this.requests = requestsInFlight(ctx.session());
    ctx.register(contents, hooks);
    guardNavigation(contents);
    contents.setWindowOpenHandler((details) => this.openPopup(details));
    const changed = () => hooks.changed();
    contents.on('did-start-loading', changed);
    contents.on('did-stop-loading', changed);
    contents.on('did-navigate', changed);
    contents.on('did-navigate-in-page', changed);
    contents.on('did-navigate', () => this.navigated());
    contents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (isMainFrame) this.navigated();
    });
    contents.on('page-title-updated', changed);
    contents.on('render-process-gone', changed);
    contents.on('dom-ready', () => this.watchSecrets());
    contents.on('did-frame-navigate', (_event, _url, _status, _statusText, isMainFrame) => {
      if (isMainFrame) this.watchSecrets();
    });
    /* Only the person's keys reach this listener. The agent's, which the
       debugger sends, go straight to the page (e2e/in-app-browser.spec.ts
       checks it). */
    contents.on('before-input-event', (event, input) => {
      hooks.personInput();
      if (input.type !== 'keyDown' || input.alt) return;
      /* Outside macOS the app menu's Close (the windowMenu role in app.ts) is
         Control+W, so closing a site's tab as a browser does would close the
         app's window, and every task's browser with it. The pane keeps the
         key. */
      if (process.platform !== 'darwin' && input.control && isLetterKey(input, 'w')) {
        event.preventDefault();
        return;
      }
      /* The person's reload chord, Command+R on macOS and Control+R
         elsewhere, reloads the site as a browser does, past the cache with
         Shift. The app menu's View > Reload and Force Reload (app.ts) take
         the same chords and act on whichever contents has focus, which is
         this view while the person types in it; a reload of the app's own UI
         would hide the browser and clear its registration (browser-host.ts).
         The pane claims the chord and reloads the site itself, so that never
         rests on which contents the menu finds focused. */
      const reloadModifier = process.platform === 'darwin' ? input.meta : input.control;
      if (reloadModifier && isLetterKey(input, 'r')) {
        event.preventDefault();
        if (input.shift) contents.reloadIgnoringCache();
        else contents.reload();
      }
    });
    contents.on('before-mouse-event', (_event, mouse) => {
      if (mouse.type === 'mouseDown') hooks.personInput();
    });
    contents.on('login', (event, _details, authInfo, callback) => {
      event.preventDefault();
      hooks.login({
        host: authInfo.host,
        respond: (answer) => (answer ? callback(answer.username, answer.password) : callback()),
      });
    });
    /* Electron's default answers with the first certificate in the OS store,
       which tells any site that asks who the person is. Continue with none:
       the callback takes no certificate, as the app event's typing says,
       though this event's typing asks for one. */
    contents.on('select-client-certificate', (event, _url, _list, callback) => {
      event.preventDefault();
      (callback as (certificate?: Certificate) => void)();
    });
    ctx.window()?.contentView.addChildView(this.view);
    if (!adopted) {
      contents.loadURL(url ?? 'about:blank').catch((error: unknown) => {
        diagnostic('main.browser-view', 'INFO', 'browser_view_first_page_did_not_load', error);
      });
    }
  }

  private get contents(): WebContents {
    return this.view.webContents;
  }

  /* window.open: a tab in this task when it follows input, refused otherwise.
     Electron builds the popup's page from overrideBrowserWindowOptions before
     createWindow runs, and a view given an existing page ignores its own
     preferences, so the lockdown goes there. The page keeps its opener's
     session. */
  private openPopup(details: HandlerDetails): WindowOpenHandlerResponse {
    if (this.closed || !navigationAllowed(details.url) || !this.hooks.popupAllowed()) return { action: 'deny' };
    const { session: _session, ...lockdown } = browserViewPreferences(this.ctx.session());
    return {
      action: 'allow',
      overrideBrowserWindowOptions: { webPreferences: lockdown },
      createWindow: (options) => {
        const view = new WebContentsView({
          webContents: (options as { webContents?: WebContents }).webContents,
          webPreferences: browserViewPreferences(this.ctx.session()),
        });
        this.hooks.adopt(new ElectronTab(this.ctx, this.hooks, null, view));
        return view.webContents;
      },
    };
  }

  url(): string {
    return this.contents.getURL();
  }

  title(): string {
    return this.contents.getTitle();
  }

  loading(): boolean {
    return this.contents.isLoading();
  }

  canGoBack(): boolean {
    return this.contents.navigationHistory.canGoBack();
  }

  canGoForward(): boolean {
    return this.contents.navigationHistory.canGoForward();
  }

  /* Runs `request` in the page's isolated world. Electron holds the script
     until the page stops loading. */
  private runInWorld<T>(request: PageWorldRequest): Promise<T> {
    return this.contents.executeJavaScriptInIsolatedWorld(PAGE_WORLD_ID, [{ code: pageWorldSource(request) }]) as Promise<T>;
  }

  /* A call into the page that may fail: null when it fails or takes longer
     than `ms`. The settle reads null as "can't tell". */
  private tryInWorld<T>(request: PageWorldRequest, ms: number): Promise<T | null> {
    return withTimeout(this.runInWorld<T>(request), ms, () => new Error('the page did not answer in time')).catch(() => null);
  }

  /* A read, which answers 409 page_busy when the page doesn't answer in time. */
  private inWorld<T>(request: PageWorldRequest): Promise<T> {
    return withTimeout(
      this.runInWorld<T>(request),
      PAGE_READ_TIMEOUT_MS,
      () => new BridgeError('page_busy', 'the page did not answer in time; it may still be loading, or a dialog may be open'),
    );
  }

  /* The addresses of every frame below the main one. Nothing runs in them. */
  private subframeUrls(): string[] {
    const main = this.contents.mainFrame;
    return main.framesInSubtree.filter((frame) => frame !== main).map((frame) => frame.url);
  }

  /* The addresses of the main frame's own child frames. */
  private childFrameUrls(): string[] {
    return this.contents.mainFrame.frames.map((frame) => frame.url);
  }

  /* The addresses of the frames inside the main frame's child frames at
     `addresses` (the frames a page read read), by the frame tree, which
     places a frame a closed shadow root keeps there too. */
  private framesInside(addresses: ReadonlySet<string>): string[] {
    return this.contents.mainFrame.frames.filter((child) => addresses.has(child.url)).flatMap((child) => child.frames.map((frame) => frame.url));
  }

  /* How many frames sit directly in the documents a screenshot's search for
     secrets walks (secretBoxes): the main frame's, and below it each
     same-origin frame's that is not a payment frame, SECRET_SEARCH_DEPTH
     deep. Each frame owner the search counts holds one of them. */
  private searchedFrames(): number {
    const main = this.contents.mainFrame;
    const count = (frame: WebFrameMain, depth: number): number => frame.frames.reduce((sum, child) => {
      const searched = depth < SECRET_SEARCH_DEPTH && child.origin === main.origin && !isPaymentAddress(child.url);
      return sum + 1 + (searched ? count(child, depth + 1) : 0);
    }, 0);
    return count(main, 0);
  }

  /* The page's world reads every frame its rules let it; the first
     FRAME_READ_RULES.read (FRAMES_READ) the look keeps read stay read
     (keepSeen). Asked for the focus (PageReadOptions), the read carries
     `focus` when the debugger names the node the focus rests on
     (focusToken); otherwise it never attaches the debugger. */
  async read(maxText: number, options: PageReadOptions = {}): Promise<PageSnapshot> {
    const raw = await this.inWorld<RawSnapshot>({ kind: 'snapshot', maxText, maxElements: MAX_ELEMENTS, frames: FRAME_READ_RULES });
    const inside = this.framesInside(new Set(raw.frames.filter((frame) => frame.read).map((frame) => frame.url)));
    const [frames, focus] = await Promise.all([this.keepSeen(raw.frames, raw.viewport), options.focus ? this.focusToken() : null]);
    const page = pageAnswer({ ...raw, frames }, challengesFrom(this.subframeUrls(), raw.frameOwners), this.childFrameUrls(), inside);
    return focus === null ? page : { ...page, focus };
  }

  /* page.json's `focus`, read through the debugger for this read only
     (FrameReads.focusToken, which names a frame's element when the focus is
     inside a frame it can't read), or null when nothing has the focus, the
     debugger can't be had (something else holds it, or the person took
     over and it was detached) or the read fails or times out. */
  private focusToken(): Promise<string | null> {
    return withDebugger(this.contents.debugger, (session) => new FrameReads(session).focusToken()).catch(() => null);
  }

  /* The frames the page's world read, kept read as the web pod reads them:
     looked at in the order the world listed them (on-screen first, then
     page order), as many at a time as reads are still wanted, until
     FRAME_READ_RULES.read are kept or FRAMES_PHASE_MS has passed since the
     first look. So a frame the look leaves unread takes none of those
     reads, however many such frames come first, and a frame past the last
     look, or past the reads kept, is listed unread. */
  private async keepSeen(frames: RawFrame[], viewport: { width: number; height: number }): Promise<RawFrame[]> {
    const kept = frames.map((frame) => (frame.read ? unread(frame) : frame));
    const waiting = frames.flatMap((frame, at) => (frame.read ? [at] : []));
    const deadline = Date.now() + FRAMES_PHASE_MS;
    let reads = 0;
    for (let next = 0; next < waiting.length && reads < FRAME_READ_RULES.read && Date.now() < deadline;) {
      const batch = waiting.slice(next, next + FRAME_READ_RULES.read - reads);
      next += batch.length;
      const looked = await Promise.all(batch.map((at) => this.lookAtFrame(frames[at], viewport)));
      batch.forEach((at, i) => {
        if (!looked[i].read) return;
        kept[at] = looked[i];
        reads += 1;
      });
    }
    return kept;
  }

  /* A frame the page's world read, kept read only when the person sees what
     the read found there (its text, or a control's name): its box, as the
     page draws it, shows more than one color (nearlyOneColor). The world's
     hit test can't see a cover that only paints, such as an element's box
     shadow or outline, or one marked pointer-events: none, and a box all one
     color is such a cover's. The frame's part in view, a CSS pixel in from
     each edge, is captured from the composited page and scaled down
     (frameLook): one small capture a frame looked at, as many at once as
     reads are still wanted (keepSeen). A look that fails, or takes longer
     than FRAME_LOOK_MS, leaves the frame unread, and so does one that finds
     the box one color. A read that found no text has nothing to look for. */
  private async lookAtFrame(frame: RawFrame, viewport: { width: number; height: number }): Promise<RawFrame> {
    if (!frame.read || !(frame.text.trim() || frame.elements.some((element) => element.name.trim()))) return frame;
    const shows = await withTimeout(this.frameShows(frame.box, viewport), FRAME_LOOK_MS, () => new Error('the frame was not captured in time'))
      .catch(() => false);
    return shows ? frame : unread(frame);
  }

  /* Whether the part in view of a frame's box (viewport CSS pixels) shows
     more than one color as the page draws it. capturePage takes
     device-independent pixels, so the view's zoom applies. */
  private async frameShows(box: Box, viewport: { width: number; height: number }): Promise<boolean> {
    const zoom = this.contents.getZoomFactor();
    const left = Math.max(box.x, 0) + 1;
    const top = Math.max(box.y, 0) + 1;
    const right = Math.min(box.x + box.width, viewport.width) - 1;
    const bottom = Math.min(box.y + box.height, viewport.height) - 1;
    const x = Math.ceil(left * zoom);
    const y = Math.ceil(top * zoom);
    const width = Math.floor(right * zoom) - x;
    const height = Math.floor(bottom * zoom) - y;
    if (width <= 0 || height <= 0) return false;
    const look = frameLook(await this.contents.capturePage({ x, y, width, height }, { stayHidden: true }), right - left);
    return look !== null && !nearlyOneColor(look);
  }

  /** Starts the page's secret-field watch on its current document
      (browser-page-script.ts). Electron holds the script until the page
      stops loading, however long that takes, so the watch has no read's time
      limit. A failure is logged, never thrown. */
  watchSecrets(): void {
    const watch = async () => {
      if (!this.closed && !this.contents.isDestroyed()) await this.runInWorld<unknown>({ kind: 'watch' });
    };
    watch().catch((error: unknown) => {
      diagnostic('main.browser-view', 'INFO', 'browser_view_secret_watch_did_not_start', error);
    });
  }

  /* Where the agent's mouse starts in a tab it hasn't used yet. */
  private async viewportCenter(): Promise<Point> {
    const viewport = await this.inWorld<{ width: number; height: number }>({ kind: 'viewport' });
    return { x: viewport.width / 2, y: viewport.height / 2 };
  }

  /* One step's view of the tab. Every page call, pause, wait and navigation
     wait in it ends with 409 human_in_control once `signal` aborts. */
  private stepHost(signal: AbortSignal): StepHost {
    const inStep = <T>(request: PageWorldRequest) => unlessTakenOver(signal, () => this.inWorld<T>(request));
    const pacing: Pacing = { sleep: (ms) => unlessTakenOver(signal, () => realPacing.sleep(ms)), random: realPacing.random };
    return {
      pacing,
      page: {
        locate: (id, reveal) => inStep<LocateResult>({ kind: 'locate', id, reveal }),
        focusedSecret: () => inStep<FocusedSecret>({ kind: 'focusedSecret' }),
        typingFocus: (id) => inStep<TypingFocus>({ kind: 'typingFocus', id }),
        focusField: (id, select) => inStep<FocusFieldResult>({ kind: 'focusField', id, select }),
        focus: (id, editing) => inStep<FocusResult>({ kind: 'focus', id, editing }),
        select: (id, values) => inStep<SelectResult>({ kind: 'select', id, values }),
        viewport: () => inStep<{ width: number; height: number }>({ kind: 'viewport' }),
        hitTest: (id, points) => inStep<HitTestResult>({ kind: 'hitTest', id, points, childFrames: this.contents.mainFrame.frames.length }),
        secretAt: (at) => inStep<boolean>({ kind: 'secretAt', at }),
      },
      nav: {
        load: (url) => unlessTakenOver(signal, () => this.load(url)),
        back: () => unlessTakenOver(signal, () => this.back()),
        forward: () => unlessTakenOver(signal, () => this.forward()),
        reload: () => unlessTakenOver(signal, () => this.reload()),
      },
      withInput: async <T>(run: (input: AgentInput, frames: FrameReads) => Promise<T>) => {
        if (signal.aborted) throw tookOver();
        const start = this.mouse ?? (await unlessTakenOver(signal, () => this.viewportCenter()));
        // The person may have taken over while the page answered.
        if (signal.aborted) throw tookOver();
        const { result, mouse } = await withAgentInput(this.contents.debugger, start, pacing, run);
        this.mouse = mouse;
        return result;
      },
    };
  }

  /**
   * Runs one step, then lets it settle, and answers whether it changed what
   * the page shows. `onInputDone` runs once the step's input is over, before
   * the settle. A wait doesn't settle and can't tell.
   */
  async act(request: StepRequest, onInputDone: () => void = () => {}): Promise<StepOutcome> {
    const step = new AbortController();
    this.step = step;
    const waitMs = request.step.action === 'wait' ? request.step.ms : 0;
    const watch = request.step.action === 'wait' ? null : this.beginWatch();
    try {
      if (watch) await this.startChanges(watch, step.signal);
      await withTimeout(runStep(this.stepHost(step.signal), request), STEP_TIMEOUT_MS + waitMs, () => {
        this.abortInput();
        return new BridgeError('page_blocked', 'the page stopped answering during the step; a dialog may be open for the person to close');
      });
      onInputDone();
      return { changed: watch ? await this.quiet(watch, request, step.signal) : null };
    } catch (error) {
      if (step.signal.aborted && !(error instanceof BridgeError && error.code === 'page_blocked')) throw tookOver();
      throw error;
    } finally {
      if (watch) this.endWatch(watch);
      if (this.step === step) this.step = null;
    }
  }

  private navigated(): void {
    if (this.watching) this.watching.navigations += 1;
  }

  /* Starts counting the step's main-frame requests and navigations. */
  private beginWatch(): StepWatch {
    this.steps += 1;
    const now = Date.now();
    const watch: StepWatch = { token: this.steps, startedAt: now, url: this.contents.getURL(), navigations: 0, watchStartedAt: now };
    this.requests.begin(this.contentsId);
    this.watching = watch;
    return watch;
  }

  /* Starts the page's change watch for the step, before its input. Electron
     holds isolated-world script while the page loads, so a page still loading
     gets no watch, and the step can't tell what it changed unless it
     navigates. */
  private async startChanges(watch: StepWatch, signal: AbortSignal): Promise<void> {
    if (this.contents.isLoadingMainFrame()) return;
    await unlessTakenOver(signal, () => this.tryInWorld({ kind: 'changeStart', token: watch.token }, CHANGE_START_MS));
    watch.watchStartedAt = Date.now();
  }

  private endWatch(watch: StepWatch): void {
    this.requests.end(this.contentsId);
    if (this.watching === watch) this.watching = null;
    if (this.closed || this.contents.isDestroyed()) return;
    this.runInWorld({ kind: 'changeStop', token: watch.token }).catch((error: unknown) => {
      diagnostic('main.browser-view', 'INFO', 'browser_view_change_watch_did_not_stop', error);
    });
  }

  /* Resolves once the page stops loading, or after `ms`, and leaves no
     listener behind. */
  private stoppedLoading(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.contents.removeListener('did-stop-loading', done);
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, ms));
      this.contents.once('did-stop-loading', done);
    });
  }

  /*
   * The step's settle, after its input. A step that started nothing (no
   * change the watch counted, no main-frame request, no navigation) on a
   * page that shows nothing aria-busy answers SETTLE_QUIET_MS into its
   * settle, so a request it starts by then is waited for, as the web pod
   * waits on a search box's debounced suggestions. Any other waits until
   * the page's main-frame requests are done, nothing it shows is aria-busy
   * and it has shown no change for SETTLE_QUIET_MS, at most SETTLE_MAX_MS,
   * and always inside the step's budget: a change in place may be a spinner
   * before a fetch the page sends a moment later. A step that changed the
   * page in place and started none of those waits SETTLE_QUIET_MS past its
   * first look at most, so a page that changes on its own (a ticker) doesn't
   * hold every step to the cap; a change that lands after that is missed.
   * Then: true when
   * the step navigated or the watch counted a change, null when the page
   * couldn't be watched or may have changed where the watch can't see (a
   * hover's :hover too), false otherwise. The person taking over ends it at
   * once with null. Never throws: the step ran.
   */
  private async quiet(watch: StepWatch, request: StepRequest, signal: AbortSignal): Promise<boolean | null> {
    const settleStart = Date.now();
    const deadline = Math.min(settleStart + SETTLE_MAX_MS, watch.startedAt + STEP_TIMEOUT_MS - SETTLE_MARGIN_MS);
    // Before this, the settle never ends for quiet: the step may still start a request.
    const requestWindow = settleStart + SETTLE_QUIET_MS;
    const takenOver = new Promise<null>((resolve) => {
      if (signal.aborted) resolve(null);
      signal.addEventListener('abort', () => resolve(null), { once: true });
    });
    const pause = (ms: number) => Promise.race([sleep(Math.max(0, Math.min(ms, deadline - Date.now()))), takenOver]);
    const at = POINTER_STEPS.has(request.step.action) ? this.mouse : null;
    const mark = () => Promise.race([this.tryInWorld<ChangeMark>({ kind: 'changeMark', token: watch.token, at }, CHANGE_MARK_MS), takenOver]);
    const navigated = () => watch.navigations > 0 || this.contents.getURL() !== watch.url;

    await pause(SETTLE_PROBE_MS);
    if (signal.aborted) return null;
    if (this.contents.isLoadingMainFrame()) await Promise.race([this.stoppedLoading(deadline - Date.now()), takenOver]);
    // A new document gets its own watch, and the quiet counts from there.
    if (navigated() && !signal.aborted && !this.contents.isLoadingMainFrame()) {
      await Promise.race([this.tryInWorld({ kind: 'changeStart', token: watch.token }, CHANGE_START_MS), takenOver]);
      watch.watchStartedAt = Date.now();
    }
    let last: ChangeMark | null = null;
    /* A step that has started nothing the page asks to be waited for (a
       request, a navigation, aria-busy) waits SETTLE_QUIET_MS past this
       first look at most, as the web pod does, so a page that changes on its
       own (a ticker) doesn't hold every step to the cap. */
    let brief = Date.now() + SETTLE_QUIET_MS;
    while (!signal.aborted) {
      last = await mark();
      const requests = this.requests.of(this.contentsId);
      if (last?.busy || requests?.sent || navigated()) brief = Infinity;
      const now = Date.now();
      if (now >= requestWindow) {
        if (!last?.changes && brief !== Infinity) break;
        const lastChange = Math.max(watch.watchStartedAt, requests?.lastEndedAt ?? 0, last ? now - last.sinceLastMs : 0);
        if (!requests?.pending && !last?.busy && now - lastChange >= SETTLE_QUIET_MS) break;
      }
      if (now >= Math.min(deadline, brief)) break;
      await pause(Math.min(SETTLE_POLL_MS, brief - now));
    }
    if (signal.aborted) return null;
    if (navigated()) return true;
    if (!last) return null;
    if (last.changes > 0) return true;
    if (last.opaque || request.step.action === 'hover') return null;
    return false;
  }

  /* Every screenshot blacks out the page's secret fields and payment frames,
     and the copies a reflection draws of its secret fields and its frames
     (screenshotMasks), and those inside its frames, each read in its own
     world (frameMasks), just before the capture. A page with a payment frame
     it can't place gets no capture at all, and so does one with a frame the
     page's search can't reach when the debugger can't read the frames. */
  async screenshot(annotate: boolean, quality: number): Promise<Screenshot> {
    const raw = annotate ? await this.inWorld<RawSnapshot>({ kind: 'snapshot', maxText: 0, maxElements: MAX_ELEMENTS, frames: null }) : null;
    const found = await this.inWorld<FoundSecrets>({ kind: 'secretBoxes', paymentHosts: PAYMENT_FRAME_HOSTS, depth: SECRET_SEARCH_DEPTH });
    const masks = screenshotMasks(found, this.subframeUrls(), this.searchedFrames());
    if (!masks) {
      throw new BridgeError('internal', "the page holds a payment frame this browser can't place to black out, so no screenshot was taken; read the page instead");
    }
    const inFrames = this.subframeUrls().length ? await this.frameMasks(found) : [];
    const image = await this.contents.capturePage(undefined, { stayHidden: true });
    const width = (raw?.viewport ?? found.viewport).width;
    return renderScreenshot(image, width, raw?.boxes ?? null, quality, (data, size) => nativeImage.createFromBitmap(data, size), [...masks, ...inFrames]);
  }

  /* What a screenshot blacks out inside the page's frames, read through the
     debugger for this capture only (FrameReads.frameMasks). When the
     debugger can't be had (something else holds it, or the person took over
     and it was detached) or the read fails, each frame the page's search
     found and couldn't enter (`found.otherSiteFrames`) is blacked out whole,
     as long as the search found every frame the frame tree places in the
     documents it searched (`searchedFrames`). Otherwise one sits where the
     search can't reach (a closed shadow root, behind an embed), so no mask
     would cover its secret fields, and no screenshot is taken, as for a
     payment frame no box covers (screenshotMasks). */
  private async frameMasks(found: FoundSecrets): Promise<Box[]> {
    try {
      return await withDebugger(this.contents.debugger, (session) => new FrameReads(session).frameMasks());
    } catch {
      if (found.owners !== this.searchedFrames()) {
        throw new BridgeError('internal', "this browser couldn't read every frame of the page to black out its secret fields, so no screenshot was taken; read the page instead");
      }
      return found.otherSiteFrames;
    }
  }

  async load(url: string): Promise<void> {
    const refused = refusedDestination(url);
    if (refused) throw new BridgeError('bad_request', refused);
    try {
      await Promise.race([this.contents.loadURL(url), sleep(NAVIGATION_WAIT_MS)]);
    } catch (error) {
      const { code = '', url: failed } = error as LoadError;
      // ERR_ABORTED: the page moved on to another address itself.
      if (code === 'ERR_ABORTED') return;
      /* ERR_BLOCKED_BY_CLIENT: the profile's request listener
         (configureBrowserSession in browser-profile.ts) refused the address,
         or the one it redirected to, which the answer names. */
      if (code === 'ERR_BLOCKED_BY_CLIENT') {
        // refusedDestination has parsed `url` already.
        const host = hostOf(failed ?? url) ?? new URL(url).host;
        throw new BridgeError('bad_request', `navigation to ${host} is blocked in this browser`);
      }
      throw new BridgeError('bad_request', `could not open ${url}${code ? ` (${code})` : ''}`);
    }
  }

  private async settle(): Promise<void> {
    if (!this.contents.isLoading()) await sleep(250);
    if (!this.contents.isLoading()) return;
    await Promise.race([
      new Promise<void>((resolve) => this.contents.once('did-stop-loading', () => resolve())),
      sleep(NAVIGATION_WAIT_MS),
    ]);
  }

  async back(): Promise<void> {
    if (!this.contents.navigationHistory.canGoBack()) return;
    this.contents.navigationHistory.goBack();
    await this.settle();
  }

  async forward(): Promise<void> {
    if (!this.contents.navigationHistory.canGoForward()) return;
    this.contents.navigationHistory.goForward();
    await this.settle();
  }

  async reload(): Promise<void> {
    this.contents.reload();
    await this.settle();
  }

  show(bounds: ViewBounds): void {
    if (this.closed) return;
    this.view.setBounds(bounds);
    // Adding a child it already has moves it to the top.
    this.ctx.window()?.contentView.addChildView(this.view);
    this.view.setVisible(true);
  }

  /* Off screen but laid out at the stage's size (parkedBounds). */
  park(bounds: ViewBounds): void {
    if (this.closed) return;
    this.view.setBounds(parkedBounds(bounds));
    this.view.setVisible(true);
  }

  abortInput(): void {
    if (this.closed) return;
    /* Ended whether or not the debugger is attached yet: a step reading the
       page before its input, or waiting, stops too. */
    this.step?.abort();
    const dbg = this.contents.debugger;
    if (dbg.isAttached()) dbg.detach();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abortInput();
    this.ctx.window()?.contentView.removeChildView(this.view);
    if (!this.contents.isDestroyed()) this.contents.close();
  }
}

export function electronTabFactory(ctx: TabContext): TabFactory {
  return { create: (hooks, url) => new ElectronTab(ctx, hooks, url) };
}
