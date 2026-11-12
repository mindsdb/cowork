/*
 * One tab of the in-app browser: an Electron WebContentsView, a child of the
 * app's window, on the account's browser profile.
 *
 * The pane's tab is placed over the pane's stage; every other tab stays laid
 * out at the stage's size but hidden, so the agent can read and act in it.
 * Page reads run in an isolated world (browser-page-script.ts) and answer
 * 409 page_busy when the page doesn't answer in time. Agent steps attach the
 * debugger for the step only (browser-input.ts). Screenshots are captured
 * without showing a hidden tab, with the page's secret fields and payment
 * frames blacked out (browser-screenshot.ts).
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
 * Each step settles before it answers (`act`). A step that changed the page,
 * or started a main-frame request or a navigation, waits until those requests
 * are done and the page has gone quiet; one that started none of them answers
 * at once. The
 * step's change watch (browser-page-script.ts) and the profile's request count
 * (RequestsInFlight in browser-profile.ts) say whether it changed what the
 * page shows.
 */

import { type BrowserWindow, type Certificate, type HandlerDetails, type Input, nativeImage, type Session, type WebContents, WebContentsView, type WebFrameMain, type WindowOpenHandlerResponse } from 'electron';
import { diagnostic } from '../shared/diagnostics';
import {
  BridgeError,
  type PageSnapshot,
  PAYMENT_FRAME_HOSTS,
  SETTLE_MAX_MS,
  SETTLE_QUIET_MS,
  type StepAction,
  type StepOutcome,
  type StepRequest,
  STEP_TIMEOUT_MS,
} from '../shared/browser-contract';
import type { FrameReads } from './browser-frames';
import { type AgentInput, type Pacing, type Point, realPacing, runStep, type StepHost, withAgentInput } from './browser-input';
import {
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
  type RawSnapshot,
  screenshotMasks,
  SECRET_SEARCH_DEPTH,
  type SelectResult,
  type TypingFocus,
} from './browser-page-script';
import { browserViewPreferences, guardNavigation, navigationAllowed, refusedDestination, type RequestsInFlight, requestsInFlight } from './browser-profile';
import { renderScreenshot, type Screenshot } from './browser-screenshot';
import type { TabFactory, TabHooks, TabView, ViewBounds } from './browser-sessions';

/* A navigation the agent asks for answers once the page loads, or after this
   long with the page still loading; anton reads the page either way. It is
   shorter than STEP_TIMEOUT_MS, so a slow load answers 200, not page_blocked. */
export const NAVIGATION_WAIT_MS = 30_000;
const MAX_ELEMENTS = 300;

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

  async read(maxText: number): Promise<PageSnapshot> {
    const raw = await this.inWorld<RawSnapshot>({ kind: 'snapshot', maxText, maxElements: MAX_ELEMENTS, frames: FRAME_READ_RULES });
    return pageAnswer(raw, challengesFrom(this.subframeUrls(), raw.frameOwners), this.childFrameUrls());
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
        /* The world can't read a frame from another site, so a key into one
           counts as a key into a secret field while the page holds a
           payment frame anywhere in its frame tree. */
        focusedSecret: async () => {
          const focus = await inStep<FocusedSecret>({ kind: 'focusedSecret' });
          return focus.secret || (focus.otherSite && this.subframeUrls().some(isPaymentAddress));
        },
        typingFocus: (id) => inStep<TypingFocus>({ kind: 'typingFocus', id }),
        focusField: (id, select) => inStep<FocusFieldResult>({ kind: 'focusField', id, select }),
        focus: (id, editing) => inStep<FocusResult>({ kind: 'focus', id, editing }),
        select: (id, values) => inStep<SelectResult>({ kind: 'select', id, values }),
        viewport: () => inStep<{ width: number; height: number }>({ kind: 'viewport' }),
        hitTest: (id, points) => inStep<HitTestResult>({ kind: 'hitTest', id, points, childFrames: this.contents.mainFrame.frames.length }),
        intoFrame: (point) => inStep<boolean>({ kind: 'intoFrame', point, childFrames: this.contents.mainFrame.frames.length }),
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
   * change the watch counted, no main-frame request, no navigation) answers
   * at once. Any other waits until the page's main-frame requests are done
   * and it has shown no change for SETTLE_QUIET_MS (a page that marks itself
   * aria-busy keeps waiting), at most SETTLE_MAX_MS, and always inside the
   * step's budget: a change in place may be a spinner before a fetch the
   * page sends a moment later. Then: true when
   * the step navigated or the watch counted a change, null when the page
   * couldn't be watched or may have changed where the watch can't see (a
   * hover's :hover too), false otherwise. The person taking over ends it at
   * once with null. Never throws: the step ran.
   */
  private async quiet(watch: StepWatch, request: StepRequest, signal: AbortSignal): Promise<boolean | null> {
    const deadline = Math.min(Date.now() + SETTLE_MAX_MS, watch.startedAt + STEP_TIMEOUT_MS - SETTLE_MARGIN_MS);
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
    while (!signal.aborted) {
      last = await mark();
      const requests = this.requests.of(this.contentsId);
      if (!last?.changes && !requests?.sent && !navigated()) break;
      const now = Date.now();
      const lastChange = Math.max(watch.watchStartedAt, requests?.lastEndedAt ?? 0, last ? now - last.sinceLastMs : 0);
      const quiet = !requests?.pending && !last?.busy && now - lastChange >= SETTLE_QUIET_MS;
      if (quiet || now >= deadline) break;
      await pause(SETTLE_POLL_MS);
    }
    if (signal.aborted) return null;
    if (navigated()) return true;
    if (!last) return null;
    if (last.changes > 0) return true;
    if (last.opaque || request.step.action === 'hover') return null;
    return false;
  }

  /* Every screenshot blacks out the page's secret fields and payment frames
     (screenshotMasks), read just before the capture. A page with a payment
     frame it can't place gets no capture at all. */
  async screenshot(annotate: boolean, quality: number): Promise<Screenshot> {
    const raw = annotate ? await this.inWorld<RawSnapshot>({ kind: 'snapshot', maxText: 0, maxElements: MAX_ELEMENTS, frames: null }) : null;
    const found = await this.inWorld<FoundSecrets>({ kind: 'secretBoxes', paymentHosts: PAYMENT_FRAME_HOSTS, depth: SECRET_SEARCH_DEPTH });
    const masks = screenshotMasks(found, this.subframeUrls(), this.searchedFrames());
    if (!masks) {
      throw new BridgeError('internal', "the page holds a payment frame this browser can't place to black out, so no screenshot was taken; read the page instead");
    }
    const image = await this.contents.capturePage(undefined, { stayHidden: true });
    const width = (raw?.viewport ?? found.viewport).width;
    return renderScreenshot(image, width, raw?.boxes ?? null, quality, (data, size) => nativeImage.createFromBitmap(data, size), masks);
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
