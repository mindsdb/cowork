/*
 * What the page's isolated world can't see, read through the view's debugger
 * while a step has it attached (withAgentInput in browser-input.ts), or a
 * screenshot does (ElectronTab.screenshot in browser-view.ts).
 *
 * `pressLandsInFrame`: where a press at a point lands. The world's own hit
 * test (elementFromPoint) stops at the host of a closed shadow root, so a
 * control that slots its own text over a frame laid in its closed root reads
 * as the control. DOM.getNodeForLocation hit-tests inside closed roots and
 * names the frame of the node it finds, as the web pod's readPoint does.
 *
 * `focusedSecret`: whether an editing key goes into a secret field the
 * world can't see: one inside a closed shadow root, where the world's focus
 * stops at the host, or inside a frame of another site. DOM.describeNode
 * reports a host's closed shadow root, and DOM.resolveNode hands it to this
 * browser's own isolated world, which follows the focus inside it. Electron
 * runs isolated-world script only in a view's main frame's process, so a
 * frame of another site is read in its own process: Target.setAutoAttach
 * (flat) gives each such frame a session on the same debugger, and
 * sendCommand takes its id.
 *
 * `frameMasks`: the secret fields a screenshot blacks out inside the frames
 * the world can't search, each read in its frame's own world, as the web
 * pod's frameMasks reads them; a frame that can't be read is blacked out
 * whole.
 *
 * Every command goes out through `DebuggerSession.send`, which checks it
 * first: only the methods in ALLOWED_CDP_METHODS; input and the page reads on
 * the page's own session, a frame's session only opening and reading its
 * world and the nodes that world answers; Runtime.evaluate and
 * Runtime.callFunctionOn only in an isolated world this attach made with
 * Page.createIsolatedWorld, and DOM.resolveNode only into one, never in the
 * page's own world, so the page's scripts never meet them; never a world
 * with universal access, nor one in a
 * frame whose address isn't known or that is a payment provider's frame or
 * inside one (isPaymentAddress); and no auto-attach that pauses a frame.
 * Nothing here sends Runtime.enable, Page.enable, Network, Debugger, Console or
 * Log commands, which make Chromium report to the protocol in ways a page can
 * notice. A world lasts for the attach, so a frame's world has seen none of
 * the person's earlier "show password" toggles there (the main frame's
 * watch in browser-page-script.ts has no such reach either).
 */

import { BridgeError, PAYMENT_FRAME_HOSTS } from '../shared/browser-contract';
import {
  type Box,
  type FocusedSecret,
  type FoundSecrets,
  isPaymentAddress,
  pageWorldFunction,
  pageWorldSource,
  type PageWorldRequest,
  SECRET_SEARCH_DEPTH,
  type ViewPoint,
} from './browser-page-script';

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
  'Runtime.callFunctionOn',
  'Runtime.releaseObject',
  'DOM.getNodeForLocation',
  'DOM.describeNode',
  'DOM.resolveNode',
  'DOM.getFrameOwner',
  'DOM.getBoxModel',
]);

/* What a frame's own session may send: its frame tree, opening and reading
   the isolated world it reads in, and the nodes that world answers. */
const FRAME_SESSION_METHODS: ReadonlySet<string> = new Set([
  'Page.getFrameTree',
  'Page.createIsolatedWorld',
  'Runtime.evaluate',
  'Runtime.callFunctionOn',
  'Runtime.releaseObject',
  'DOM.describeNode',
  'DOM.resolveNode',
]);

/* How many closed shadow roots deep a read of the focus follows it. A focus
   deeper than that counts as one on a secret field. */
const CLOSED_ROOTS_DEEP = 8;

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
  frame: { id: string; url: string; parentId?: string; securityOrigin?: string };
  childFrames?: FrameTree[];
}

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
  parentFrameId?: string;
}

/* A frame as the debugger last reported it: its address, the frame it sits
   in, its origin when its frame tree gave one, and the session of a frame of
   another site, which runs in its own process (none for a frame in the
   page's own process). */
interface KnownFrame {
  url: string;
  parentId: string | null;
  origin?: string;
  session?: string;
}

interface Evaluated {
  result?: { subtype?: string; objectId?: string; value?: unknown };
  exceptionDetails?: unknown;
}

/* The box around a quad's four corners (x1, y1, ... x4, y4). */
function quadBox(quad: number[]): Box {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/* The part of `box` inside `within`, or null when none is. */
function clip(box: Box, within: Box): Box | null {
  const x = Math.max(box.x, within.x);
  const y = Math.max(box.y, within.y);
  const right = Math.min(box.x + box.width, within.x + within.width);
  const bottom = Math.min(box.y + box.height, within.y + within.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
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
    const ownWorld = (id: unknown) => this.worlds.get(session ?? '')?.has(id as number) ?? false;
    switch (method) {
      case 'Runtime.evaluate':
        return ownWorld(params.contextId) ? null : 'it must name an isolated world this attach made';
      case 'Runtime.callFunctionOn':
        // Called on an object, it would run in whatever world holds the object.
        if (params.objectId !== undefined) return 'it must run in an isolated world this attach made, not on an object';
        return ownWorld(params.executionContextId) ? null : 'it must name an isolated world this attach made';
      case 'DOM.resolveNode':
        return ownWorld(params.executionContextId) ? null : 'it must resolve into an isolated world this attach made';
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
      origin: tree.frame.securityOrigin ?? known?.origin,
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

  /* Runs `request` in frame `frameId`'s world, from its document, or from
     `from`, a node this attach handed that world (closedRootOf): its answer
     by value, or, with `node`, the id of the element it answers (null for
     none), which the caller releases. Arguments of another world are
     refused by Chromium, so `from` runs in this world alone. */
  private async evaluate(frameId: string, request: PageWorldRequest, node: boolean, from: string | null): Promise<Evaluated['result']> {
    const { id, session } = await this.world(frameId);
    const answer = from === null
      ? await this.send<Evaluated>('Runtime.evaluate', { expression: pageWorldSource(request), contextId: id, returnByValue: !node }, session)
      : await this.send<Evaluated>('Runtime.callFunctionOn', {
        functionDeclaration: pageWorldFunction(request), executionContextId: id, arguments: [{ objectId: from }], returnByValue: !node,
      }, session);
    if (answer.exceptionDetails || !answer.result) throw new Error('the frame did not answer');
    return answer.result;
  }

  /** `request`'s answer from frame `frameId`'s own world, read from its
      document or from `from` (a closed shadow root, closedRootOf). */
  async read<T>(frameId: string, request: PageWorldRequest, from: string | null = null): Promise<T> {
    return (await this.evaluate(frameId, request, false, from))?.value as T;
  }

  /** Lets go of `objectId`, a node frame `frameId`'s world holds for this attach. */
  async release(frameId: string, objectId: string): Promise<void> {
    await this.send('Runtime.releaseObject', { objectId }, this.frames.get(frameId)?.session).catch(() => {});
  }

  /** The frames the page's isolated world can't search for secrets
      (secretBoxes in browser-page-script.ts): each child of a frame it
      searches (the main one, and below it each frame of the main frame's
      origin in the page's process that is no payment frame, `depth` deep,
      as ElectronTab.searchedFrames counts them) that it doesn't search
      itself. Call it once mainFrame and attachFrames have answered. */
  unsearchedFrames(main: string, depth: number): string[] {
    const origin = this.frames.get(main)?.origin;
    const found: string[] = [];
    const visit = (parent: string, level: number) => {
      for (const [id, frame] of this.frames) {
        if (frame.parentId !== parent) continue;
        const searched = level < depth && frame.session === undefined && !!origin && frame.origin === origin && !isPaymentAddress(frame.url);
        if (searched) visit(id, level + 1);
        else found.push(id);
      }
    };
    visit(main, 0);
    return found;
  }

  /** The content and border boxes, in the page's viewport, of the element
      that holds frame `frameId`. It fails for one that draws nothing. */
  async ownerBoxes(frameId: string): Promise<{ content: Box; border: Box }> {
    const { backendNodeId } = await this.send<{ backendNodeId: number }>('DOM.getFrameOwner', { frameId });
    const { model } = await this.send<{ model: { content: number[]; border: number[] } }>('DOM.getBoxModel', { backendNodeId });
    return { content: quadBox(model.content), border: quadBox(model.border) };
  }

  /** The frame that the element `request` answers in frame `frameId`'s
      world (from `from`) holds, or null when it answers none or holds no
      frame. */
  async frameOf(frameId: string, request: PageWorldRequest, from: string | null = null): Promise<string | null> {
    const found = await this.evaluate(frameId, request, true, from);
    if (found?.subtype !== 'node' || !found.objectId) return null;
    try {
      const { node } = await this.send<{ node: { frameId?: string } }>('DOM.describeNode', { objectId: found.objectId, depth: 0 }, this.frames.get(frameId)?.session);
      return node.frameId ?? null;
    } finally {
      await this.release(frameId, found.objectId);
    }
  }

  /** The closed shadow root of the element `request` answers in frame
      `frameId`'s world (from `from`), handed to that world, or null when it
      answers none or the element keeps no closed root. DOM.describeNode
      reports a host's shadow roots, closed ones included, and
      DOM.resolveNode hands one to the world. The caller releases it. */
  async closedRootOf(frameId: string, request: PageWorldRequest, from: string | null = null): Promise<string | null> {
    const found = await this.evaluate(frameId, request, true, from);
    if (found?.subtype !== 'node' || !found.objectId) return null;
    const { id, session } = await this.world(frameId);
    try {
      const { node } = await this.send<{ node: { shadowRoots?: Array<{ shadowRootType?: string; backendNodeId: number }> } }>(
        'DOM.describeNode',
        { objectId: found.objectId, depth: 0, pierce: true },
        session,
      );
      const root = node.shadowRoots?.find((shadow) => shadow.shadowRootType === 'closed');
      if (!root) return null;
      const { object } = await this.send<{ object: { objectId?: string } }>('DOM.resolveNode', { backendNodeId: root.backendNodeId, executionContextId: id }, session);
      if (!object.objectId) throw new Error('the closed shadow root did not resolve');
      return object.objectId;
    } finally {
      await this.release(frameId, found.objectId);
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
   * Whether an editing key now goes into a secret field the page's world
   * can't see, read where the focus rests: inside a closed shadow root,
   * whose host is as far as the world's focus goes (closedRootOf hands the
   * root to this browser's world in that frame, which follows the focus
   * inside it), and inside a frame of another site, in that frame's own
   * world, closed roots there included, as the web pod's keysGoToSecret
   * reads it. A key into an ordinary field there still goes in. Whatever
   * can't be read counts as a secret field: a payment provider's frame (no
   * world opens there), a frame of yet another site the focus sits in
   * inside it, a frame with no owner the debugger can name, a focus more
   * than CLOSED_ROOTS_DEEP closed roots deep, and a read that fails or
   * takes longer than FRAME_READ_MS.
   */
  async focusedSecret(): Promise<boolean> {
    const read = async () => this.secretFocusIn(await this.session.mainFrame(), true);
    return withTimeout(read(), FRAME_READ_MS).catch(() => true);
  }

  /* `focusedSecret` in frame `frameId`, from its document: `top` for the
     page's main frame, whose focus may go on into a frame of another site. */
  private async secretFocusIn(frameId: string, top: boolean): Promise<boolean> {
    let from: string | null = null;
    try {
      for (let roots = 0; roots <= CLOSED_ROOTS_DEEP; roots += 1) {
        const focus: FocusedSecret = await this.session.read<FocusedSecret>(frameId, { kind: 'focusedSecret' }, from);
        if (focus.secret) return true;
        if (focus.otherSite) {
          if (!top) return true;
          const inner = await this.session.frameOf(frameId, { kind: 'focusedFrame' }, from);
          if (!inner) return true;
          await this.session.attachFrames();
          return await this.secretFocusIn(inner, false);
        }
        if (!focus.sealed) return false;
        const root: string | null = await this.session.closedRootOf(frameId, { kind: 'focusedElement' }, from);
        if (from !== null) await this.session.release(frameId, from);
        from = root;
        if (from === null) return false;
      }
      return true;
    } finally {
      if (from !== null) await this.session.release(frameId, from);
    }
  }

  /**
   * What a screenshot blacks out inside the frames the page's world can't
   * search (`unsearchedFrames`), in the page's viewport: each one's secret
   * fields, payment frames and frames it can't search in turn, read in its
   * own world and kept inside its content box; the whole frame when it
   * can't be read (a payment provider's frame, where no world opens, or one
   * that doesn't answer within FRAME_READ_MS). A frame whose owner draws
   * nothing has nothing to black out.
   */
  async frameMasks(): Promise<Box[]> {
    const main = await this.session.mainFrame();
    await this.session.attachFrames();
    const masks = await Promise.all(this.session.unsearchedFrames(main, SECRET_SEARCH_DEPTH).map(async (frameId) => {
      const owner = await this.session.ownerBoxes(frameId).catch(() => null);
      if (!owner) return [];
      const read = this.session.read<FoundSecrets>(frameId, { kind: 'secretBoxes', paymentHosts: PAYMENT_FRAME_HOSTS, depth: SECRET_SEARCH_DEPTH });
      const found = await withTimeout(read, FRAME_READ_MS).catch(() => null);
      if (!found) return [owner.border];
      const { content } = owner;
      return [...found.secrets, ...found.paymentFrames, ...found.otherSiteFrames]
        .map((box) => clip({ ...box, x: box.x + content.x, y: box.y + content.y }, content))
        .filter((box): box is Box => box !== null);
    }));
    return masks.flat();
  }
}
