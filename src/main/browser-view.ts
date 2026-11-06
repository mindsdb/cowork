/*
 * One tab of the in-app browser: an Electron WebContentsView, a child of the
 * app's window, on the account's browser profile.
 *
 * The pane's tab is placed over the pane's stage; every other tab stays laid
 * out at the stage's size but hidden, so the agent can read and act in it.
 * Page reads run in an isolated world (browser-page-script.ts) and answer
 * 409 page_busy when the page doesn't answer in time. Agent steps attach the
 * debugger for the step only (browser-input.ts). Screenshots are captured
 * without showing a hidden tab (browser-screenshot.ts).
 *
 * Popups become tabs of the same task, keeping window.opener for sign-in
 * flows, and only right after an agent step or the person's own input. A
 * site's sign-in prompt (HTTP authentication) goes to the person in the pane.
 */

import { nativeImage, type BrowserWindow, type HandlerDetails, type Session, type WebContents, WebContentsView, type WindowOpenHandlerResponse } from 'electron';
import { diagnostic } from '../shared/diagnostics';
import { BridgeError, type PageSnapshot, type StepRequest } from '../shared/browser-contract';
import { type AgentInput, type Point, realPacing, runStep, type StepHost, withAgentInput } from './browser-input';
import {
  challengeKind,
  challengesFrom,
  type DomFrame,
  type FrameInfo,
  type LocateResult,
  PAGE_READ_TIMEOUT_MS,
  PAGE_WORLD_ID,
  pageAnswer,
  pageWorldSource,
  type PageWorldRequest,
  type RawSnapshot,
  type SelectResult,
} from './browser-page-script';
import { browserViewPreferences, guardNavigation, navigationAllowed, refusedDestination } from './browser-profile';
import { renderScreenshot, type Screenshot } from './browser-screenshot';
import type { TabFactory, TabHooks, TabView, ViewBounds } from './browser-sessions';

/* A navigation the agent asks for answers once the page loads, or after this
   long with the page still loading; anton reads the page either way. */
const NAVIGATION_WAIT_MS = 30_000;
/* A step that hasn't finished by then has met something that blocks the page,
   most often a dialog the person must answer. */
const STEP_TIMEOUT_MS = 45_000;
const FRAME_SIZE_TIMEOUT_MS = 2_000;
const MAX_ELEMENTS = 300;

function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  private aborted = false;
  private closed = false;

  constructor(private readonly ctx: TabContext, private readonly hooks: TabHooks, url: string | null, adopted?: WebContentsView) {
    this.view = adopted ?? new WebContentsView({ webPreferences: browserViewPreferences(ctx.session()) });
    const contents = this.view.webContents;
    ctx.register(contents, hooks);
    guardNavigation(contents);
    contents.setWindowOpenHandler((details) => this.openPopup(details));
    const changed = () => hooks.changed();
    contents.on('did-start-loading', changed);
    contents.on('did-stop-loading', changed);
    contents.on('did-navigate', changed);
    contents.on('did-navigate-in-page', changed);
    contents.on('page-title-updated', changed);
    contents.on('render-process-gone', changed);
    contents.on('before-input-event', () => hooks.personInput());
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

  /* window.open: a tab in this task when it follows input, refused otherwise. */
  private openPopup(details: HandlerDetails): WindowOpenHandlerResponse {
    if (this.closed || !navigationAllowed(details.url) || !this.hooks.popupAllowed()) return { action: 'deny' };
    return {
      action: 'allow',
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

  private inWorld<T>(request: PageWorldRequest): Promise<T> {
    return withTimeout(
      this.contents.executeJavaScriptInIsolatedWorld(PAGE_WORLD_ID, [{ code: pageWorldSource(request) }]) as Promise<T>,
      PAGE_READ_TIMEOUT_MS,
      () => new BridgeError('page_busy', 'the page did not answer in time; it may still be loading, or a dialog may be open'),
    );
  }

  /* The size a check frame reports for itself, asked only when the page's DOM
     has no element for it. */
  private async frameInfos(domFrames: DomFrame[]): Promise<FrameInfo[]> {
    const domHosts = new Set(domFrames.flatMap((f) => {
      try {
        return [new URL(f.url).hostname];
      } catch {
        return [];
      }
    }));
    const frames = this.contents.mainFrame.framesInSubtree.filter((frame) => frame !== this.contents.mainFrame && challengeKind(frame.url));
    return Promise.all(frames.map(async (frame): Promise<FrameInfo> => {
      if (domHosts.has(new URL(frame.url).hostname)) return { url: frame.url, size: null };
      try {
        const [width, height] = await withTimeout(
          frame.executeJavaScript('[innerWidth, innerHeight]') as Promise<[number, number]>,
          FRAME_SIZE_TIMEOUT_MS,
          () => new Error('the frame did not answer'),
        );
        return { url: frame.url, size: { width, height } };
      } catch {
        return { url: frame.url, size: null };
      }
    }));
  }

  async read(maxText: number): Promise<PageSnapshot> {
    const raw = await this.inWorld<RawSnapshot>({ kind: 'snapshot', maxText, maxElements: MAX_ELEMENTS });
    return pageAnswer(raw, challengesFrom(await this.frameInfos(raw.frames), raw.frames));
  }

  /* Where the agent's mouse starts in a tab it hasn't used yet. */
  private async viewportCenter(): Promise<Point> {
    const viewport = await this.inWorld<{ width: number; height: number }>({ kind: 'viewport' });
    return { x: viewport.width / 2, y: viewport.height / 2 };
  }

  private stepHost(): StepHost {
    return {
      pacing: realPacing,
      page: {
        locate: (id, reveal) => this.inWorld<LocateResult>({ kind: 'locate', id, reveal }),
        focusedSecret: async () => (await this.inWorld<{ secret: boolean }>({ kind: 'focusedSecret' })).secret,
        selectContents: async (id) => (await this.inWorld<{ ok: boolean }>({ kind: 'selectContents', id })).ok,
        select: (id, values) => this.inWorld<SelectResult>({ kind: 'select', id, values }),
        viewport: () => this.inWorld<{ width: number; height: number }>({ kind: 'viewport' }),
      },
      nav: {
        load: (url) => this.load(url),
        back: () => this.back(),
        forward: () => this.forward(),
        reload: () => this.reload(),
      },
      withInput: async <T>(run: (input: AgentInput) => Promise<T>) => {
        if (this.aborted) throw new BridgeError('human_in_control', 'The person took over the browser.');
        const start = this.mouse ?? (await this.viewportCenter());
        const { result, mouse } = await withAgentInput(this.contents.debugger, start, realPacing, run);
        this.mouse = mouse;
        return result;
      },
    };
  }

  async act(request: StepRequest): Promise<void> {
    this.aborted = false;
    const waitMs = request.step.action === 'wait' ? request.step.ms : 0;
    try {
      await withTimeout(runStep(this.stepHost(), request), STEP_TIMEOUT_MS + waitMs, () => {
        this.abortInput();
        return new BridgeError('page_blocked', 'the page stopped answering during the step; a dialog may be open for the person to close');
      });
    } catch (error) {
      if (this.aborted && !(error instanceof BridgeError && error.code === 'page_blocked')) {
        throw new BridgeError('human_in_control', 'The person took over the browser.');
      }
      throw error;
    } finally {
      this.aborted = false;
    }
  }

  async screenshot(annotate: boolean, quality: number): Promise<Screenshot> {
    const raw = annotate ? await this.inWorld<RawSnapshot>({ kind: 'snapshot', maxText: 0, maxElements: MAX_ELEMENTS }) : null;
    const viewport = raw?.viewport ?? await this.inWorld<{ width: number; height: number }>({ kind: 'viewport' });
    const image = await this.contents.capturePage(undefined, { stayHidden: true });
    return renderScreenshot(image, viewport.width, raw?.boxes ?? null, quality, (data, size) => nativeImage.createFromBitmap(data, size));
  }

  async load(url: string): Promise<void> {
    const refused = refusedDestination(url);
    if (refused) throw new BridgeError('bad_request', refused);
    try {
      await Promise.race([this.contents.loadURL(url), sleep(NAVIGATION_WAIT_MS)]);
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      // ERR_ABORTED: the page moved on to another address itself.
      if (code === 'ERR_ABORTED') return;
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
    const dbg = this.contents.debugger;
    if (dbg.isAttached()) {
      this.aborted = true;
      dbg.detach();
    }
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
