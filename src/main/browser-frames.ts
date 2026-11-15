/*
 * What the page's isolated world can't see, read through the view's debugger
 * while a step has it attached (withAgentInput in browser-input.ts), or a
 * screenshot does (ElectronTab.screenshot in browser-view.ts), or a page read
 * does for its `focus` (ElectronTab.read).
 *
 * `frameAt`: where a press at a point lands. The world's own hit test
 * (elementFromPoint) stops at the host of a closed shadow root, so a control
 * that slots its own text over a frame laid in its closed root reads as the
 * control. DOM.getNodeForLocation hit-tests inside closed roots and names the
 * frame of the node it finds, as the web pod's readPoint does. `frameUnder`
 * adds the frame's address, which binds a press the person approved into a
 * frame to that frame.
 *
 * `focusedSecret`: whether an editing key goes into a secret field the
 * world can't see: one inside a closed shadow root, where the world's focus
 * stops at the host, or inside a frame of another site. DOM.describeNode
 * reports a host's closed shadow root, and DOM.resolveNode hands it to this
 * browser's own isolated world, which follows the focus inside it. Electron
 * runs isolated-world script only in a view's main frame's process, so a
 * frame of another site is read in its own process: Target.setAutoAttach
 * (flat) gives each such frame a session on the same debugger, and
 * sendCommand takes its id. `focusedField` follows the focus the same way
 * for a type with focused true, and names the text entry it rests on by its
 * frame and DOM.describeNode's backend node id; `focusToken` names any node
 * it rests on so, for a page read's `focus`, and the frame element where the
 * focus goes on into a frame it can't read.
 *
 * `frameMasks`: the secret fields a screenshot blacks out inside the frames
 * below the main one, each read in its frame's own world, as the web pod's
 * frameMasks reads them: those the world can't search, and those it does,
 * since its search can't reach a frame in a closed shadow root. A frame that
 * can't be read is blacked out whole. Inside a frame the world can't
 * search, a frame that frame's own search can't reach (one in a closed
 * shadow root there) is read too: one of its origin for its secret fields,
 * and any other, when it is secret, blacked out whole where the debugger
 * places its owner.
 *
 * `frameSecrets`: page.json's frame `secret` for the frames a page read's
 * world can't look into: whether each one, or a frame inside it at any
 * depth, is a payment provider's frame or holds a secret, card-named or
 * sign-in field, read in each frame's own world and in each frame the
 * debugger knows inside it, one in a closed shadow root included, a frame
 * of yet another site inside another site's attached through that frame's
 * session.
 *
 * Every command goes out through `DebuggerSession.send`, which checks it
 * first: only the methods in ALLOWED_CDP_METHODS; input and the page reads on
 * the page's own session, a frame's session only auto-attaching its own
 * frames of other sites, opening and reading its world and the nodes that
 * world answers, and placing the elements that hold its frames;
 * Runtime.evaluate and Runtime.callFunctionOn only in an isolated world
 * this attach made with Page.createIsolatedWorld, and DOM.resolveNode only
 * into one, never in the
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
  type FocusedTyping,
  type FoundSecrets,
  isPaymentAddress,
  type LookedFrames,
  pageWorldFunction,
  pageWorldSource,
  type PageWorldRequest,
  SECRET_SEARCH_DEPTH,
  type SecretLook,
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

/* What a frame's own session may send: its frame tree, an auto-attach to
   the frames of other sites in it (attachFrames), opening and reading the
   isolated world it reads in, the nodes that world answers, and where the
   elements that hold its own frames draw them (ownerBoxes), which the
   debugger finds inside closed shadow roots too. */
const FRAME_SESSION_METHODS: ReadonlySet<string> = new Set([
  'Target.setAutoAttach',
  'Page.getFrameTree',
  'Page.createIsolatedWorld',
  'Runtime.evaluate',
  'Runtime.callFunctionOn',
  'Runtime.releaseObject',
  'DOM.describeNode',
  'DOM.resolveNode',
  'DOM.getFrameOwner',
  'DOM.getBoxModel',
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

/* How a box in a frame's own viewport (`view`: its innerWidth and
   innerHeight) lands in the page's viewport through its owner's content
   quad, which a CSS transform may scale or turn: scaled by the quad's size
   over the view's, from the quad's top left corner. Null when the quad is
   turned, skewed or mirrored, which no box maps through, or the view is
   empty. */
function throughQuad(quad: number[], view: { width: number; height: number }): ((box: Box) => Box) | null {
  const [x1, y1, x2, y2, x3, y3, x4, y4] = quad;
  const level = (a: number, b: number) => Math.abs(a - b) < 0.5;
  if (!level(y1, y2) || !level(x2, x3) || !level(y3, y4) || !level(x4, x1) || x2 <= x1 || y4 <= y1) return null;
  if (!(view.width > 0) || !(view.height > 0)) return null;
  const sx = (x2 - x1) / view.width;
  const sy = (y4 - y1) / view.height;
  return (box) => ({ x: x1 + box.x * sx, y: y1 + box.y * sy, width: box.width * sx, height: box.height * sy });
}

/* The part of `box` inside `within`, or null when none is. */
function clip(box: Box, within: Box): Box | null {
  const x = Math.max(box.x, within.x);
  const y = Math.max(box.y, within.y);
  const right = Math.min(box.x + box.width, within.x + within.width);
  const bottom = Math.min(box.y + box.height, within.y + within.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/* An address without its fragment, which Chromium's frame tree leaves out
   of a frame's url while the page's own frame list keeps it. */
function withoutFragment(address: string): string {
  const hash = address.indexOf('#');
  return hash === -1 ? address : address.slice(0, hash);
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
  /* Each session's auto-attach, by session ('' for the page's own). */
  private readonly attached = new Map<string, Promise<unknown>>();
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
      without pausing any: those the page's own process holds, or, with
      `inFrame`, those the process of frame `inFrame` holds. Chromium
      attaches to a session only the frames of another process nearest it,
      so a frame of yet another site inside another site's frame is
      attached through that frame's session. */
  async attachFrames(inFrame?: string): Promise<void> {
    const session = inFrame === undefined ? undefined : this.frames.get(inFrame)?.session;
    const key = session ?? '';
    if (!this.attached.has(key)) {
      this.attached.set(key, this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, session));
    }
    await this.attached.get(key);
  }

  /** Frame `frameId`'s address as this attach last learned it, or null for
      a frame it doesn't know. */
  knownAddress(frameId: string): string | null {
    return this.frames.get(frameId)?.url ?? null;
  }

  /** The frames this attach knows of that sit directly in frame `parentId`,
      with their addresses. */
  childFrames(parentId: string): Array<{ id: string; url: string }> {
    return [...this.frames].filter(([, frame]) => frame.parentId === parentId).map(([id, frame]) => ({ id, url: frame.url }));
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

  /** The frames whose owners sit in the documents a search for secrets in
      frame `from`'s isolated world covers (secretBoxes in
      browser-page-script.ts, `depth` deep): each frame of `from`'s origin
      in its process that is no payment frame, which it enters, marked
      `searched`, since that search can't reach one in a closed shadow root;
      and each child of a frame it searches that it doesn't search itself.
      From the main frame, these are the frames a screenshot reads in their
      own worlds (frameMasks), and the ones it searches are those
      ElectronTab.searchedFrames counts. Call it once `from`'s frame tree
      (mainFrame, or its world's read) and attachFrames(`from`) have
      answered. */
  framesToRead(from: string, depth: number): Array<{ id: string; searched: boolean }> {
    const top = this.frames.get(from);
    const found: Array<{ id: string; searched: boolean }> = [];
    const visit = (parent: string, level: number) => {
      for (const [id, frame] of this.frames) {
        if (frame.parentId !== parent) continue;
        const searched = level < depth && frame.session === top?.session && !!top?.origin && frame.origin === top.origin && !isPaymentAddress(frame.url);
        found.push({ id, searched });
        if (searched) visit(id, level + 1);
      }
    };
    visit(from, 0);
    return found;
  }

  /** Whether frame `frameId` runs in a process of its own: a frame of
      another site, which auto-attach gave its own session, so the boxes
      that session gives (ownerBoxes) are in its own viewport, not the
      page's. */
  ownView(frameId: string): boolean {
    const frame = this.frames.get(frameId);
    return frame?.session !== undefined && frame.session !== this.frames.get(frame.parentId ?? '')?.session;
  }

  /** Frame `frameId`'s address now, from its frame tree: the page's, or a
      frame of another site's own, its session given by auto-attach. '' for
      an owner that names no frame (frameAt). */
  async frameAddress(frameId: string): Promise<string> {
    if (frameId.startsWith(OWNER_NODE)) return '';
    await this.attachFrames();
    await this.send('Page.getFrameTree', {}, this.frames.get(frameId)?.session);
    const url = this.frames.get(frameId)?.url;
    if (url === undefined) throw new Error('the frame is not known');
    return url;
  }

  /** The content quad and border box of the element that holds frame
      `frameId`, as drawn, its transforms applied, read on the session of
      the process that holds that element, inside a closed shadow root too:
      in the page's viewport for an element in the page's process, and in
      the own viewport of the frame of another site it sits in otherwise
      (ownView). It fails for one that draws nothing. */
  async ownerBoxes(frameId: string): Promise<{ content: number[]; border: Box }> {
    const session = this.frames.get(this.frames.get(frameId)?.parentId ?? '')?.session;
    const { backendNodeId } = await this.send<{ backendNodeId: number }>('DOM.getFrameOwner', { frameId }, session);
    const { model } = await this.send<{ model: { content: number[]; border: number[] } }>('DOM.getBoxModel', { backendNodeId }, session);
    return { content: model.content, border: quadBox(model.border) };
  }

  /* How the debugger describes the element `request` answers in frame
     `frameId`'s world (from `from`), or null when it answers none. */
  private async described(frameId: string, request: PageWorldRequest, from: string | null): Promise<{ frameId?: string; backendNodeId?: number } | null> {
    const found = await this.evaluate(frameId, request, true, from);
    if (found?.subtype !== 'node' || !found.objectId) return null;
    try {
      const { node } = await this.send<{ node: { frameId?: string; backendNodeId?: number } }>(
        'DOM.describeNode',
        { objectId: found.objectId, depth: 0 },
        this.frames.get(frameId)?.session,
      );
      return node;
    } finally {
      await this.release(frameId, found.objectId);
    }
  }

  /** The frame that the element `request` answers in frame `frameId`'s
      world (from `from`) holds, or null when it answers none or holds no
      frame. */
  async frameOf(frameId: string, request: PageWorldRequest, from: string | null = null): Promise<string | null> {
    return (await this.described(frameId, request, from))?.frameId ?? null;
  }

  /** The backend node id of the element `request` answers in frame
      `frameId`'s world (from `from`), which stays the same while the
      element does, or null when it answers none. It throws when the
      debugger names no node. */
  async nodeOf(frameId: string, request: PageWorldRequest, from: string | null = null): Promise<number | null> {
    const node = await this.described(frameId, request, from);
    if (node === null) return null;
    if (node.backendNodeId === undefined) throw new Error('the debugger named no node');
    return node.backendNodeId;
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

/* How frameAt names an owner that names no frame of its own (a plugin's
   embed): by its node, which stays the same while the node does. */
const OWNER_NODE = 'owner:';

/** A frame a press lands in: its id and its address then. */
export interface FramePlace {
  id: string;
  url: string;
}

/** What has the focus for a type with focused true (FrameReads.focusedField):
    a text entry that isn't secret, with `field` naming it by its frame and
    its node and `inControl` saying a key there reaches a control a Space key
    may click (FocusedTyping); a secret field or one named for a card;
    anything else; or a focus this browser can't read. */
export type FocusedField =
  | { kind: 'entry'; field: string; inControl: boolean }
  | { kind: 'secret' | 'other' | 'unreadable' };

interface LayoutMetrics {
  cssLayoutViewport: { pageX: number; pageY: number };
}

/** The reads a step makes through the debugger. */
export class FrameReads {
  constructor(private readonly session: DebuggerSession) {}

  /**
   * The frame a press at viewport point `at` lands in, inside closed shadow
   * roots too, or null for none: the frame an element that holds one holds
   * (an owner that names none stands for one by its node), or the frame of
   * the node's own document when that isn't the page's. DOM.getNodeForLocation
   * takes the document's coordinates, so the page's scroll is added. It
   * throws when the debugger can't say.
   */
  async frameAt(at: ViewPoint): Promise<string | null> {
    const main = await this.session.mainFrame();
    const { cssLayoutViewport: view } = await this.session.send<LayoutMetrics>('Page.getLayoutMetrics');
    const found = await this.session.send<{ backendNodeId: number; frameId?: string }>('DOM.getNodeForLocation', {
      x: Math.round(at.x + view.pageX),
      y: Math.round(at.y + view.pageY),
    });
    const { node } = await this.session.send<{ node: { localName?: string; frameId?: string } }>('DOM.describeNode', { backendNodeId: found.backendNodeId, depth: 0 });
    if (node.frameId) return node.frameId;
    if (FRAME_OWNERS.has(node.localName ?? '')) return `${OWNER_NODE}${found.backendNodeId}`;
    if (found.frameId === main) return null;
    if (!found.frameId) throw new Error("the node's frame is not known");
    return found.frameId;
  }

  /** Whether a press at viewport point `at` lands in a frame (frameAt). A
      read that fails counts as a frame. */
  async pressLandsInFrame(at: ViewPoint): Promise<boolean> {
    return this.frameAt(at).then((frame) => frame !== null, () => true);
  }

  /** The frame a press at viewport point `at` lands in and its address now,
      null for none, or 'unread' when the debugger can't say. */
  async frameUnder(at: ViewPoint): Promise<FramePlace | null | 'unread'> {
    try {
      const id = await this.frameAt(at);
      return id === null ? null : { id, url: await this.session.frameAddress(id) };
    } catch {
      return 'unread';
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
    const read = async () => this.followFocus(await this.session.mainFrame(), true, true, async (focus) => focus.secret);
    return withTimeout(read(), FRAME_READ_MS).catch(() => true);
  }

  /**
   * What has the focus for a type with focused true, read where it rests as
   * `focusedSecret` reads it: a text entry that isn't secret (focusedEntry
   * in browser-page-script.ts), named by its frame and its node so a later
   * read tells whether the focus is still on the same field, with whether a
   * key there reaches a control a Space key may click; a secret field, or
   * one the card-field rule page.json pins for both hosts names for a card
   * (CARD_FIELD_RULE, which the world's state carries, and FocusedTyping);
   * anything else; or `unreadable`, for whatever `focusedSecret` counts as
   * secret because it can't read it (a
   * payment provider's frame, a frame of yet another site inside another
   * site's, a frame with no owner the debugger can name, a focus past
   * CLOSED_ROOTS_DEEP closed roots, and a read that fails or takes longer
   * than FRAME_READ_MS).
   */
  async focusedField(): Promise<FocusedField> {
    const unreadable: FocusedField = { kind: 'unreadable' };
    const read = async () => this.followFocus<FocusedField>(await this.session.mainFrame(), true, unreadable, async (focus, frameId, from) => {
      if (focus.secret) return { kind: 'secret' };
      const typing = await this.session.read<FocusedTyping>(frameId, { kind: 'focusedTyping' }, from);
      if (typing.cardNamed) return { kind: 'secret' };
      const node = await this.session.nodeOf(frameId, { kind: 'focusedEntry' }, from);
      return node === null ? { kind: 'other' } : { kind: 'entry', field: `${frameId}/${node}`, inControl: typing.inControl };
    });
    return withTimeout(read(), FRAME_READ_MS).catch(() => unreadable);
  }

  /**
   * page.json's `focus`: an opaque token naming the node the focus rests on,
   * the deepest one through frames that this browser can read, followed as
   * `focusedSecret` follows it (through same-origin frames in the world,
   * closed shadow roots and a frame of another site), as the frame whose
   * world reads it and DOM.describeNode's backend node id, which stays the
   * same while the node does ("frame:node"). Where the focus goes on into a
   * frame this browser can't read, it names that frame's element, so a focus
   * that moves from one such frame to another changes the token: a payment
   * provider's frame (no world opens there), a frame of yet another site
   * inside another site's, a frame the debugger names no frame of, and a
   * frame whose read fails. Past CLOSED_ROOTS_DEEP closed roots it names the
   * deepest node it reached. Null while nothing has the focus, and when the
   * page can't be read at all: a read that fails before it reaches the focus
   * or takes longer than FRAME_READ_MS.
   */
  async focusToken(): Promise<string | null> {
    const named = async (frameId: string, from: string | null): Promise<string | null> => {
      const node = await this.session.nodeOf(frameId, { kind: 'focusedNode' }, from);
      return node === null ? null : `${frameId}:${node}`;
    };
    const read = async () => this.followFocus<string | null>(await this.session.mainFrame(), true, null, (_focus, frameId, from) => named(frameId, from), named);
    return withTimeout(read(), FRAME_READ_MS).catch(() => null);
  }

  /* Follows the focus from frame `frameId`'s document (`top` for the page's
     main frame, whose focus may go on into a frame of another site) through
     closed shadow roots and into a frame of another site, and answers what
     `at` makes of the world's read where it rests (its frame, and the closed
     root it is read from, null for the document). Where it can't follow, it
     answers what `stop` makes of the world's read where it stopped, and
     `unread` when no `stop` is given: at a frame of yet another site inside
     another site's, a frame owner the debugger names no frame of, a frame
     whose read fails (a payment provider's frame, where no world opens,
     among them), and past CLOSED_ROOTS_DEEP closed roots. */
  private async followFocus<T>(
    frameId: string,
    top: boolean,
    unread: T,
    at: (focus: FocusedSecret, frameId: string, from: string | null) => Promise<T>,
    stop: (frameId: string, from: string | null) => Promise<T> = async () => unread,
  ): Promise<T> {
    let from: string | null = null;
    try {
      for (let roots = 0; roots <= CLOSED_ROOTS_DEEP; roots += 1) {
        const focus: FocusedSecret = await this.session.read<FocusedSecret>(frameId, { kind: 'focusedSecret' }, from);
        if (focus.secret) return await at(focus, frameId, from);
        if (focus.otherSite) {
          if (!top) return await stop(frameId, from);
          const inner = await this.session.frameOf(frameId, { kind: 'focusedFrame' }, from);
          if (!inner) return await stop(frameId, from);
          await this.session.attachFrames();
          return await this.followFocus(inner, false, unread, at, stop).catch(() => stop(frameId, from));
        }
        if (!focus.sealed) return await at(focus, frameId, from);
        const root: string | null = await this.session.closedRootOf(frameId, { kind: 'focusedElement' }, from);
        if (root === null) return await at(focus, frameId, from);
        if (from !== null) await this.session.release(frameId, from);
        from = root;
      }
      return await stop(frameId, from);
    } finally {
      if (from !== null) await this.session.release(frameId, from);
    }
  }

  /* page.json's frame `secret` for frames this attach knows, each looked
     into once per look (frameSecrets, frameMasks). A frame is secret when
     it is on a payment provider's host (no world opens there, and nothing
     is sent to its session), or its own world finds a private field or a
     payment frame in its document or a frame it enters (frameSecret in
     browser-page-script.ts). Where that world finds none, or doesn't
     answer, each frame the debugger knows in it is looked into in turn, at
     any depth, a frame of yet another site attached through its own
     session (attachFrames): the world can't look into another site's
     frame, nor see one in a closed shadow root. `anySecret` answers
     whether any of `frameIds` is found secret, as soon as one is, so a
     frame beside it whose world never answers doesn't hold the answer. */
  private secretLooks(): { secretIn: (frameId: string) => Promise<boolean>; anySecret: (frameIds: string[]) => Promise<boolean> } {
    const looks = new Map<string, Promise<boolean>>();
    const anySecret = (frameIds: string[]): Promise<boolean> => Promise.any(frameIds.map(async (frameId) => {
      if (!(await secretIn(frameId))) throw new Error('no secret found');
    })).then(() => true, () => false);
    const secretIn = (frameId: string): Promise<boolean> => {
      let looking = looks.get(frameId);
      if (!looking) {
        looking = (async () => {
          if (isPaymentAddress(this.session.knownAddress(frameId) ?? await this.session.frameAddress(frameId))) return true;
          const own = await this.session.read<boolean | null>(frameId, { kind: 'frameSecret', paymentHosts: PAYMENT_FRAME_HOSTS }).catch(() => null);
          if (own === true) return true;
          await this.session.attachFrames(frameId);
          return anySecret(this.session.childFrames(frameId).map(({ id }) => id));
        })().catch(() => false);
        looks.set(frameId, looking);
      }
      return looking;
    };
    return { secretIn, anySecret };
  }

  /**
   * page.json's frame `secret` for what a page read's world couldn't look
   * into (SecretLook), until `deadline` (epoch ms), each frame looked into
   * as secretLooks says: a frame its own world finds nothing in is still
   * secret when the debugger knows a secret frame in it, one kept in a
   * closed shadow root there among them. A listed frame is named by its
   * owner's path, which the main frame's world here follows to the owner
   * while its address is the one the read listed (frameOwner), and
   * DOM.describeNode names the frame it holds; an unplaced one, by its
   * address among the page's own frames, or among those of the frames the
   * read read, where any frame of that address found secret marks it. What
   * isn't found by the deadline (a frame whose world doesn't answer in
   * time, an owner the page moved, a frame the debugger can't name) is
   * left out, as page.json lets a host leave out a frame it can't look into
   * within frames_phase_ms.
   */
  async frameSecrets(look: SecretLook, deadline: number): Promise<LookedFrames> {
    const frames = new Set<number>();
    const unplaced = new Set<string>();
    const nestedUnplaced = new Set<string>();
    const found = (): LookedFrames => ({ frames: new Set(frames), unplaced: new Set(unplaced), nestedUnplaced: new Set(nestedUnplaced) });
    if (deadline <= Date.now()) return found();
    const { secretIn, anySecret } = this.secretLooks();
    const sameAddress = (url: string) => (frame: { url: string }) => withoutFragment(frame.url) === withoutFragment(url);
    const work = async () => {
      const main = await this.session.mainFrame();
      await this.session.attachFrames();
      const own = this.session.childFrames(main);
      const insideRead = own.filter((frame) => look.readUrls.some((url) => sameAddress(url)(frame))).flatMap(({ id }) => this.session.childFrames(id));
      await Promise.all([
        ...look.frames.map(async ({ at, path, url }) => {
          const frameId = await this.session.frameOf(main, { kind: 'frameOwner', path, url });
          if (frameId !== null && await secretIn(frameId)) frames.add(at);
        }),
        ...look.unplaced.map(async (url) => {
          if (await anySecret(own.filter(sameAddress(url)).map(({ id }) => id))) unplaced.add(url);
        }),
        ...look.nestedUnplaced.map(async (url) => {
          if (await anySecret(insideRead.filter(sameAddress(url)).map(({ id }) => id))) nestedUnplaced.add(url);
        }),
      ].map((each) => each.catch(() => {})));
    };
    await withTimeout(work(), deadline - Date.now()).catch(() => {});
    return found();
  }

  /**
   * What a screenshot blacks out inside the frames below the main one
   * (`framesToRead`), in the page's viewport, each read in its own world,
   * placed through its owner's content quad, so a frame a transform scales
   * is blacked out where it is drawn (one it turns, whole), and kept inside
   * its content box. A frame the page's world can't search: its
   * secret fields, payment frames and frames it can't search in turn. A
   * frame that world searched, which it can't reach in a closed shadow root:
   * the secret fields and payment frames of its own document, its frames
   * being read on their own. Either way, the copies -webkit-box-reflect
   * draws there of its secret fields and, whole, of its frames
   * (FoundSecrets); a copy the page's world draws of the frame itself is
   * that world's to black out. A field both reads find is blacked out twice,
   * which shows the same. A frame that can't be read (a payment provider's
   * frame, where no world opens, or one that doesn't answer within
   * FRAME_READ_MS, the look into the frames it holds included) is blacked
   * out whole. A frame whose owner draws nothing has nothing to black out.
   * In a frame the page's world can't search, the frames that frame's own
   * search can't reach (one in a closed shadow root there) are read too
   * (hiddenSecretFrames): one of its origin for the secret fields of its own
   * document, and any other, when it is secret (secretLooks), blacked out
   * whole where the debugger places its owner; the frame that holds them is
   * blacked out whole when the debugger can't place one.
   */
  async frameMasks(): Promise<Box[]> {
    const main = await this.session.mainFrame();
    await this.session.attachFrames();
    const { secretIn } = this.secretLooks();
    const masks = await Promise.all(this.session.framesToRead(main, SECRET_SEARCH_DEPTH).map(async ({ id: frameId, searched }) => {
      const owner = await this.session.ownerBoxes(frameId).catch(() => null);
      if (!owner) return [];
      const depth = searched ? 0 : SECRET_SEARCH_DEPTH;
      const read = async () => {
        const found = await this.session.read<FoundSecrets>(frameId, { kind: 'secretBoxes', paymentHosts: PAYMENT_FRAME_HOSTS, depth });
        return { found, hidden: searched ? [] : await this.hiddenSecretFrames(frameId, found.owners, secretIn) };
      };
      const answer = await withTimeout(read(), FRAME_READ_MS).catch(() => null);
      const place = answer && throughQuad(owner.content, answer.found.viewport);
      if (!answer || !place || !answer.hidden) return [owner.border];
      const { found } = answer;
      const hidden = this.session.ownView(frameId) ? answer.hidden.map(place) : answer.hidden;
      const content = quadBox(owner.content);
      return [...found.secrets, ...found.paymentFrames, ...found.mirroredFrames, ...(searched ? [] : found.otherSiteFrames)]
        .map(place)
        .concat(hidden)
        .map((box) => clip(box, content))
        .filter((box): box is Box => box !== null);
    }));
    return masks.flat();
  }

  /* What a screenshot blacks out in frame `frameId` that its own world's
     search for secrets may not have reached, as the debugger places it
     (ownerBoxes: in the frame's own view when it runs in a process of its
     own, else in the page's), or null when something there can't be
     placed. That search counts the frame owners it finds in the documents
     it searches (FoundSecrets' `owners`) and reaches none in a closed
     shadow root, while the debugger knows each frame there (framesToRead
     from the frame, its frames of other sites auto-attached). When the
     debugger knows no more of them than the search counted, the search
     found every one, and nothing more is looked into. Otherwise, as for the
     page's own frames: each frame of its origin the search would enter is
     read for the secret fields and payment frames of its own document in
     its own world, placed through its owner, so one the search did reach
     is never blacked out whole; and each other frame there that is secret
     (`secretIn`) is blacked out whole, its owner's border box. */
  private async hiddenSecretFrames(frameId: string, owners: number, secretIn: (frameId: string) => Promise<boolean>): Promise<Box[] | null> {
    await this.session.attachFrames(frameId);
    const inside = this.session.framesToRead(frameId, SECRET_SEARCH_DEPTH);
    if (inside.length <= owners) return [];
    const masks = await Promise.all(inside.map(async ({ id, searched }): Promise<Box[] | null> => {
      if (!searched) return (await secretIn(id)) ? this.session.ownerBoxes(id).then(({ border }) => [border], () => null) : [];
      const found = await this.session.read<FoundSecrets>(id, { kind: 'secretBoxes', paymentHosts: PAYMENT_FRAME_HOSTS, depth: 0 });
      const shown = [...found.secrets, ...found.paymentFrames, ...found.mirroredFrames];
      if (!shown.length) return [];
      const owner = await this.session.ownerBoxes(id).catch(() => null);
      if (!owner) return null;
      const place = throughQuad(owner.content, found.viewport);
      if (!place) return [owner.border];
      const content = quadBox(owner.content);
      return shown.map((box) => clip(place(box), content)).filter((box): box is Box => box !== null);
    }));
    return masks.every((mask): mask is Box[] => mask !== null) ? masks.flat() : null;
  }
}
