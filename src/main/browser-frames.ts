/*
 * What the page's isolated world can't see, read through the view's debugger
 * while a step has it attached (withAgentInput in browser-input.ts).
 *
 * `pressLandsInFrame`: where a press at a point lands. The world's own hit
 * test (elementFromPoint) stops at the host of a closed shadow root, so a
 * control that slots its own text over a frame laid in its closed root reads
 * as the control. DOM.getNodeForLocation hit-tests inside closed roots and
 * names the frame of the node it finds, as the web pod's readPoint does.
 *
 * `focusedFrameSecret`: whether an editing key goes into a secret field
 * inside a frame of another site, which the world can't read. Electron runs
 * isolated-world script only in a view's main frame's process, so the read
 * runs in the frame's own process: Target.setAutoAttach (flat) gives each
 * such frame a session on the same debugger, and sendCommand takes its id.
 *
 * Every command goes out through `DebuggerSession.send`, which checks it
 * first: only the methods in ALLOWED_CDP_METHODS; input and the page reads on
 * the page's own session, a frame's session only opening and reading its
 * world; Runtime.evaluate only in an isolated world this attach made with
 * Page.createIsolatedWorld, never in the page's own world, so the page's
 * scripts never meet it; never a world with universal access, nor one in a
 * frame whose address isn't known or that is a payment provider's frame or
 * inside one (isPaymentAddress); and no auto-attach that pauses a frame.
 * Nothing here sends Runtime.enable, Page.enable, Network, Debugger, Console or
 * Log commands, which make Chromium report to the protocol in ways a page can
 * notice. A world lasts for the attach, so a frame's world has seen none of
 * the person's earlier "show password" toggles there (the main frame's
 * watch in browser-page-script.ts has no such reach either).
 */

import { BridgeError } from '../shared/browser-contract';
import { type FocusedSecret, isPaymentAddress, pageWorldSource, type PageWorldRequest, type ViewPoint } from './browser-page-script';

/** The only commands main ever sends through a view's debugger. */
export const ALLOWED_CDP_METHODS: ReadonlySet<string> = new Set([
  // A step's input (browser-input.ts).
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  'Emulation.setFocusEmulationEnabled',
  // The reads the page's isolated world can't make (FrameReads).
  'Target.setAutoAttach',
  'Page.getFrameTree',
  'Page.getLayoutMetrics',
  'Page.createIsolatedWorld',
  'Runtime.evaluate',
  'Runtime.releaseObject',
  'DOM.getNodeForLocation',
  'DOM.describeNode',
]);

/* What a frame's own session may send: its frame tree, and opening and
   reading the isolated world it reads in. */
const FRAME_SESSION_METHODS: ReadonlySet<string> = new Set(['Page.getFrameTree', 'Page.createIsolatedWorld', 'Runtime.evaluate']);

/** How long a read in a frame's own world may take. One that takes longer
    counts as unreadable. The web pod waits as long (FRAME_FOCUS_MS). */
export const FRAME_READ_MS = 2_000;

/* The isolated worlds' name. Pages can't see it. */
const WORLD_NAME = 'page-reads';

type CdpListener = (event: unknown, method: string, params: unknown, sessionId: string) => void;

/** The part of Electron's webContents.debugger this module uses. */
export interface CdpDebugger {
  attach(protocolVersion?: string): void;
  detach(): void;
  isAttached(): boolean;
  sendCommand(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
  on(event: 'message', listener: CdpListener): unknown;
  removeListener(event: 'message', listener: CdpListener): unknown;
}

interface FrameTree {
  frame: { id: string; url: string; parentId?: string };
  childFrames?: FrameTree[];
}

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
  parentFrameId?: string;
}

/* A frame as the debugger last reported it: its address, the frame it sits
   in, and the session of a frame of another site, which runs in its own
   process (none for a frame in the page's own process). */
interface KnownFrame {
  url: string;
  parentId: string | null;
  session?: string;
}

interface Evaluated {
  result?: { subtype?: string; objectId?: string; value?: unknown };
  exceptionDetails?: unknown;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('the frame did not answer in time')), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** One attach of the debugger: the frames it was told of, the worlds it
    made, and the checks every command passes. */
export class DebuggerSession {
  private main: Promise<string> | null = null;
  private attached: Promise<unknown> | null = null;
  private readonly frames = new Map<string, KnownFrame>();
  /* The worlds this attach made, by session ('' for the page's own). */
  private readonly worlds = new Map<string, Set<number>>();
  /* Each frame's world, opened once per attach. */
  private readonly frameWorlds = new Map<string, Promise<number>>();

  constructor(private readonly dbg: CdpDebugger) {}

  /** Chromium's events: the frames of other sites that auto-attach brings,
      and the ones that go. */
  readonly listener: CdpListener = (_event, method, params) => {
    if (method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = params as { sessionId: string; targetInfo: TargetInfo };
      if (targetInfo.type === 'iframe') {
        this.frames.set(targetInfo.targetId, { url: targetInfo.url, parentId: targetInfo.parentFrameId ?? null, session: sessionId });
      }
    } else if (method === 'Target.detachedFromTarget') {
      const { sessionId } = params as { sessionId: string };
      for (const [id, frame] of this.frames) if (frame.session === sessionId) this.frames.delete(id);
      this.worlds.delete(sessionId);
    }
  };

  /** Sends `method` on the page's session, or on frame session `session`,
      once it passes the checks, and refuses it otherwise. */
  async send<T = unknown>(method: string, params: Record<string, unknown> = {}, session?: string): Promise<T> {
    const refused = this.refusal(method, params, session);
    if (refused) throw new Error(`refused to send ${method} to the page: ${refused}`);
    const answer = (await (session === undefined ? this.dbg.sendCommand(method, params) : this.dbg.sendCommand(method, params, session))) as T;
    if (method === 'Page.getFrameTree') this.learn((answer as { frameTree: FrameTree }).frameTree, session);
    if (method === 'Page.createIsolatedWorld') {
      const key = session ?? '';
      if (!this.worlds.has(key)) this.worlds.set(key, new Set());
      this.worlds.get(key)!.add((answer as { executionContextId: number }).executionContextId);
    }
    return answer;
  }

  /* Why `method` may not go out, or null when it may. */
  private refusal(method: string, params: Record<string, unknown>, session: string | undefined): string | null {
    if (!ALLOWED_CDP_METHODS.has(method)) return 'it is not one this browser sends';
    if (session !== undefined && !FRAME_SESSION_METHODS.has(method)) return "a frame's session only opens and reads its own world";
    if (session !== undefined && ![...this.frames.values()].some((frame) => frame.session === session)) return 'no frame of this attach has that session';
    switch (method) {
      case 'Runtime.evaluate':
        return this.worlds.get(session ?? '')?.has(params.contextId as number) ? null : 'it must name an isolated world this attach made';
      case 'Page.createIsolatedWorld':
        if (params.grantUniveralAccess) return "a world with universal access reaches other sites' frames";
        return this.worldRefusal(String(params.frameId));
      case 'Target.setAutoAttach':
        return params.waitForDebuggerOnStart === false && params.flatten === true ? null : 'it must not pause a frame, and must give each one its own session';
      default:
        return null;
    }
  }

  /* Why no world may open in frame `frameId`: its address isn't known, or it
     or a frame it sits in is a payment provider's. The page's own main frame,
     which the page's isolated world reads anyway, always may. */
  private worldRefusal(frameId: string): string | null {
    const seen = new Set<string>();
    let frame = this.frames.get(frameId);
    if (!frame?.url) return "the frame's address is not known";
    if (frame.parentId === null && frame.session === undefined) return null;
    for (let id: string | null = frameId; id && !seen.has(id); id = frame?.parentId ?? null) {
      seen.add(id);
      frame = this.frames.get(id);
      if (frame && isPaymentAddress(frame.url)) return "it is a payment provider's frame, or inside one";
    }
    return null;
  }

  /* Records the frames a frame tree reports. A frame of another site keeps
     its session, and the frame it sits in when its own tree leaves that out. */
  private learn(tree: FrameTree, session: string | undefined): void {
    const known = this.frames.get(tree.frame.id);
    this.frames.set(tree.frame.id, {
      url: tree.frame.url,
      parentId: tree.frame.parentId ?? known?.parentId ?? null,
      session: known?.session ?? session,
    });
    for (const child of tree.childFrames ?? []) this.learn(child, session);
  }

  /** The page's main frame's id, asked once per attach. */
  mainFrame(): Promise<string> {
    this.main ??= this.send<{ frameTree: FrameTree }>('Page.getFrameTree').then(({ frameTree }) => frameTree.frame.id);
    return this.main;
  }

  /** Gives each frame of another site its own session, once per attach,
      without pausing any. */
  async attachFrames(): Promise<void> {
    this.attached ??= this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await this.attached;
  }

  /* The service's isolated world in frame `frameId`, opened once per attach
     on the frame's own session (none for a frame in the page's process),
     with the frame's address read first. */
  private world(frameId: string): Promise<{ id: number; session?: string }> {
    const session = this.frames.get(frameId)?.session;
    if (!this.frameWorlds.has(frameId)) {
      this.frameWorlds.set(frameId, (async () => {
        await this.send('Page.getFrameTree', {}, session);
        const { executionContextId } = await this.send<{ executionContextId: number }>('Page.createIsolatedWorld', { frameId, worldName: WORLD_NAME }, session);
        return executionContextId;
      })());
    }
    return this.frameWorlds.get(frameId)!.then((id) => ({ id, session }));
  }

  /* Runs `request` in frame `frameId`'s world: its answer by value, or, with
     `node`, the id of the element it answers (null for none), which the
     caller releases. */
  private async evaluate(frameId: string, request: PageWorldRequest, node: boolean): Promise<Evaluated['result']> {
    const { id, session } = await this.world(frameId);
    const answer = await this.send<Evaluated>('Runtime.evaluate', { expression: pageWorldSource(request), contextId: id, returnByValue: !node }, session);
    if (answer.exceptionDetails || !answer.result) throw new Error('the frame did not answer');
    return answer.result;
  }

  /** `request`'s answer from frame `frameId`'s own world. */
  async read<T>(frameId: string, request: PageWorldRequest): Promise<T> {
    return (await this.evaluate(frameId, request, false))?.value as T;
  }

  /** The frame that the element `request` answers in frame `frameId`'s
      world holds, or null when it answers none or holds no frame. */
  async frameOf(frameId: string, request: PageWorldRequest): Promise<string | null> {
    const found = await this.evaluate(frameId, request, true);
    if (found?.subtype !== 'node' || !found.objectId) return null;
    try {
      const { node } = await this.send<{ node: { frameId?: string } }>('DOM.describeNode', { objectId: found.objectId, depth: 0 });
      return node.frameId ?? null;
    } finally {
      await this.send('Runtime.releaseObject', { objectId: found.objectId }).catch(() => {});
    }
  }
}

/**
 * Attaches the debugger, runs `run` and detaches, whatever happens. A
 * debugger that is already attached means something else holds it, so the
 * call is refused rather than shared.
 */
export async function withDebugger<T>(dbg: CdpDebugger, run: (session: DebuggerSession) => Promise<T>): Promise<T> {
  if (dbg.isAttached()) throw new BridgeError('page_busy', 'the page is busy with another step');
  dbg.attach('1.3');
  const session = new DebuggerSession(dbg);
  dbg.on('message', session.listener);
  try {
    return await run(session);
  } finally {
    dbg.removeListener('message', session.listener);
    if (dbg.isAttached()) dbg.detach();
  }
}

/* The elements that hold another document, as the page world's FRAME_TAGS
   names them. */
const FRAME_OWNERS: ReadonlySet<string> = new Set(['iframe', 'frame', 'object', 'embed']);

interface LayoutMetrics {
  cssLayoutViewport: { pageX: number; pageY: number };
}

/** The reads a step makes through the debugger. */
export class FrameReads {
  constructor(private readonly session: DebuggerSession) {}

  /**
   * Whether a press at viewport point `at` lands in a frame: on an element
   * that holds one, or on a node of another frame's document, inside closed
   * shadow roots too. DOM.getNodeForLocation takes the document's
   * coordinates, so the page's scroll is added. A read that fails counts as
   * a frame.
   */
  async pressLandsInFrame(at: ViewPoint): Promise<boolean> {
    try {
      const main = await this.session.mainFrame();
      const { cssLayoutViewport: view } = await this.session.send<LayoutMetrics>('Page.getLayoutMetrics');
      const found = await this.session.send<{ backendNodeId: number; frameId?: string }>('DOM.getNodeForLocation', {
        x: Math.round(at.x + view.pageX),
        y: Math.round(at.y + view.pageY),
      });
      if (found.frameId !== main) return true;
      const { node } = await this.session.send<{ node: { localName?: string; frameId?: string } }>('DOM.describeNode', { backendNodeId: found.backendNodeId, depth: 0 });
      return Boolean(node.frameId) || FRAME_OWNERS.has(node.localName ?? '');
    } catch {
      return true;
    }
  }

  /**
   * Whether an editing key now goes into a secret field in the frame the
   * focus rests on, one the page's world can't read: the field focused
   * there, read in that frame's own world, as the web pod's keysGoToSecret
   * reads it. Whatever can't be read counts as one: a payment provider's
   * frame (no world opens there), a frame of yet another site the focus
   * sits in inside it, a frame with no owner the debugger can name, and a
   * read that fails or takes longer than FRAME_READ_MS.
   */
  async focusedFrameSecret(): Promise<boolean> {
    const read = async () => {
      const frameId = await this.session.frameOf(await this.session.mainFrame(), { kind: 'focusedFrame' });
      if (!frameId) return true;
      await this.session.attachFrames();
      const focus = await this.session.read<FocusedSecret>(frameId, { kind: 'focusedSecret' });
      return focus.secret || focus.otherSite;
    };
    return withTimeout(read(), FRAME_READ_MS).catch(() => true);
  }
}
