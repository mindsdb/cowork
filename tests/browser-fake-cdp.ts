/*
 * A fake of Electron's webContents.debugger for the in-app browser's
 * main-process tests: it answers the reads src/main/browser-frames.ts makes
 * over the debugger the way Chromium does, from a small model of the page
 * and its frames, and records every command it was sent.
 */

import { vi } from 'vitest';
import type { CdpDebugger } from '../src/main/browser-frames';
import type { Box, FocusedSecret, FoundSecrets } from '../src/main/browser-page-script';

/** One frame of the page: in the page's own process unless `remote` (a
    frame of another site, which gets its own session once auto-attached). */
export interface FakeFrame {
  id: string;
  url: string;
  parentId: string | null;
  /** The frame's security origin, for a frame in the page's process. */
  origin?: string;
  remote?: boolean;
  /** Where the focus is, as the frame's own world reads it from its document. */
  focus?: FocusedSecret;
  /** Where the focus is inside each closed shadow root it passes, in turn:
      the first is inside the root of the element `focus` stops on (`sealed`),
      the next inside the root of the element that one stops on. */
  closedRoots?: FocusedSecret[];
  /** The backend node id of the text entry that isn't secret where the
      focus rests in this frame, as the frame's own world answers a type
      with focused true (focusedEntry); none when it rests on anything else.
      A test changes it to move the focus to another field. */
  entry?: number;
  /** The backend node id of the node the focus rests on in this frame, as
      the frame's own world answers a page read's focus (focusedNode); none
      while nothing has the focus there. A test changes it to move the
      focus. */
  focused?: number;
  /** The focus rests on a field the page names for a card, as the frame's
      own world answers a type with focused true (focusedTyping). */
  cardNamed?: boolean;
  /** That field sits in a control a Space key clicks (focusedTyping). */
  inControl?: boolean;
  /** What the frame's own world finds for a screenshot, in its own viewport's pixels. */
  secrets?: Partial<FoundSecrets>;
  /** The frame's owner element: its content and border boxes in the
      viewport of the process that holds it, as DOM.getBoxModel gives them on
      that process's session (the page's viewport for an owner in the page's
      process, that frame's own for one inside a frame of another site), or
      null when it draws nothing. `quad` is its content quad when a transform
      turns it. The frame's own viewport is its content box's size unless
      `secrets.viewport` says otherwise. */
  owner?: { content: Box; border: Box; quad?: number[] } | null;
  /** The address the frame's owner element names (an iframe's src, an
      object's data), as DOM.describeNode gives its attributes on the
      session of the process that holds it; `url` unless it says otherwise,
      as while the frame still loads it at about:blank or ''. */
  src?: string;
  /** The owner element's tag: iframe unless it says otherwise. */
  ownerTag?: 'iframe' | 'frame' | 'object' | 'embed';
  /** The frame's world never answers. */
  hangs?: boolean;
  /** The frame's world answers every read with an exception. */
  throws?: boolean;
  /** The page dropped the frame just after the debugger listed it: frame
      trees and auto-attach still list it, while Page.createIsolatedWorld
      and DOM.getFrameOwner find no such frame, as Chromium answers for a
      removed frame. */
  gone?: boolean;
  /** Chromium lists the frame in the process the debugger asks, but its
      owner element sits in another one, so DOM.getFrameOwner answers that
      the frame doesn't belong to that target. */
  unplaced?: boolean;
  /** What the frame's own world answers a look for a secret (frameSecret):
      true when it finds a secret, card-named or sign-in field or a payment
      frame in its document or a frame it enters, null when it finds none
      but meets a frame it can't enter, false (the default) otherwise. */
  holds?: boolean | null;
  /** Where its owner sits as a page read lists it (RawFrame's `path`): the
      main frame's world answers that owner for this path and the frame's
      address (frameOwner). */
  path?: number[];
}

/** What DOM.getNodeForLocation finds at a document point: the node's frame,
    its tag, and the frame it holds when it is a frame owner. */
export interface FakeNode {
  frameId: string;
  localName: string;
  ownsFrame?: string;
}

export interface FakeCdpPage {
  frames: FakeFrame[];
  /** The page's own main frame, beyond its address. */
  main?: Partial<FakeFrame>;
  /** The node at viewport point (x, y). The default is a button of the main frame. */
  nodeAt?: (x: number, y: number) => FakeNode | null;
  /** The frame the owner holding the focus holds, when the page's focus rests on one: in the
      main frame's document, unless `main.focus` says otherwise, or inside a closed root there. */
  focusedOwnerOf?: string | null;
  scroll?: { x: number; y: number };
}

export type SentCommand = [method: string, params: Record<string, unknown>, sessionId: string | undefined];

type Listener = (event: unknown, method: string, params: unknown, sessionId: string) => void;

export type FakeCdpDebugger = CdpDebugger & {
  page: FakeCdpPage;
  sent: SentCommand[];
  attaches: number;
  detaches: number;
  sendCommand(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
  on(event: 'message', listener: Listener): unknown;
  removeListener(event: 'message', listener: Listener): unknown;
};

export const MAIN_FRAME = 'main';

const quad = (box: Box) => [box.x, box.y, box.x + box.width, box.y, box.x + box.width, box.y + box.height, box.x, box.y + box.height];

const FOCUS_NONE: FocusedSecret = { secret: false, otherSite: false, sealed: false };

const SECRETS_NONE: FoundSecrets = { secrets: [], paymentFrames: [], otherSiteFrames: [], mirroredFrames: [], owners: 0, viewport: { width: 400, height: 100 } };

/** A plain page at https://a.test/ with a button everywhere and no frames, unless `page` says otherwise. */
export function fakeCdpDebugger(page: Partial<FakeCdpPage> = {}): FakeCdpDebugger {
  const model: FakeCdpPage = {
    frames: [{ id: MAIN_FRAME, url: 'https://a.test/', parentId: null, origin: 'https://a.test', ...page.main }, ...(page.frames ?? [])],
    nodeAt: page.nodeAt,
    focusedOwnerOf: page.focusedOwnerOf ?? null,
    scroll: page.scroll ?? { x: 0, y: 0 },
  };
  let attached = false;
  let nextWorld = 1;
  const worlds = new Map<string, string>();
  const nodes = new Map<number, FakeNode>();
  /* The closed shadow roots resolveNode hands out, by backend node id. */
  const closedRoots = new Map<number, { frame: FakeFrame; level: number }>();
  const listeners: Listener[] = [];
  const sessionOf = (frame: FakeFrame) => `session-${frame.id}`;
  const frameOfSession = (sessionId: string | undefined) => model.frames.find((f) => f.remote && sessionOf(f) === sessionId);
  const frame = (id: unknown) => model.frames.find((f) => f.id === id);
  /* The nearest frame of another process a frame sits in, whose session
     auto-attaches it, or none for one the page's own session does. */
  const remoteAbove = (inner: FakeFrame): FakeFrame | undefined => {
    for (let at = frame(inner.parentId); at; at = frame(at.parentId)) if (at.remote) return at;
    return undefined;
  };
  /* The frame of another process whose session reaches a frame's owner
     element: the frame it sits in when that is one, else the nearest one
     above, none for an owner in the page's own process. */
  const ownerProcess = (owned: FakeFrame): FakeFrame | undefined => {
    const parent = frame(owned.parentId);
    return parent?.remote ? parent : parent && remoteAbove(parent);
  };
  /* The owner element of frame `owned`, by the backend node id
     DOM.getFrameOwner gives it, which only the session of the process that
     holds it finds. */
  const ownerOf = (backendNodeId: unknown, sessionId: string | undefined): FakeFrame | undefined => {
    const owned = model.frames[Number(backendNodeId) - 1000];
    return owned && ownerProcess(owned) === frameOfSession(sessionId) ? owned : undefined;
  };
  const tree = (root: FakeFrame): unknown => ({
    frame: { id: root.id, url: root.url, ...(root.parentId ? { parentId: root.parentId } : {}), securityOrigin: root.origin ?? (URL.canParse(root.url) ? new URL(root.url).origin : '') },
    childFrames: model.frames.filter((f) => f.parentId === root.id && !f.remote).map(tree),
  });

  const answer = (method: string, params: Record<string, unknown>, sessionId: string | undefined): unknown => {
    switch (method) {
      case 'Target.setAutoAttach': {
        /* As Chromium attaches them: each frame of another process whose
           nearest such frame above it is this session's, none for the
           page's own. */
        const above = sessionId === undefined ? undefined : frameOfSession(sessionId);
        if (sessionId !== undefined && !above) throw new Error('No session with given id');
        for (const remote of model.frames.filter((f) => f.remote && remoteAbove(f) === above)) {
          const event = { sessionId: sessionOf(remote), targetInfo: { targetId: remote.id, type: 'iframe', url: remote.url, parentFrameId: remote.parentId } };
          for (const listener of listeners) listener({}, 'Target.attachedToTarget', event, sessionId ?? '');
        }
        return {};
      }
      case 'Page.getFrameTree': {
        const root = sessionId === undefined ? frame(MAIN_FRAME)! : frameOfSession(sessionId);
        if (!root) throw new Error('No session with given id');
        return { frameTree: tree(root) };
      }
      case 'Page.getLayoutMetrics':
        return { cssLayoutViewport: { pageX: model.scroll!.x, pageY: model.scroll!.y, clientWidth: 800, clientHeight: 600 } };
      case 'DOM.getNodeForLocation': {
        const found = (model.nodeAt ?? (() => ({ frameId: MAIN_FRAME, localName: 'button' })))(Number(params.x) - model.scroll!.x, Number(params.y) - model.scroll!.y);
        if (!found) throw new Error('No node found at given location');
        const id = nodes.size + 1;
        nodes.set(id, found);
        return { backendNodeId: id, frameId: found.frameId };
      }
      case 'DOM.describeNode': {
        if (params.objectId === 'focused-owner') return { node: { localName: 'iframe', nodeName: 'IFRAME', frameId: model.focusedOwnerOf } };
        const listed = /^owner:(.+)$/.exec(String(params.objectId ?? ''));
        if (listed) return { node: { localName: 'iframe', nodeName: 'IFRAME', frameId: listed[1] } };
        const entry = /^(?:entry|focused):(.+):(\d+)$/.exec(String(params.objectId ?? ''));
        if (entry) return { node: { localName: 'input', nodeName: 'INPUT', backendNodeId: Number(entry[2]) } };
        // The element the focus stops on in a frame, at a closed-root level: its closed root, when it keeps one.
        const host = /^focus:(.+):(\d+)$/.exec(String(params.objectId ?? ''));
        if (host) {
          const [, frameId, level] = host;
          const owner = frame(frameId)!;
          if (!owner.closedRoots?.[Number(level)]) return { node: { localName: 'x-host', nodeName: 'X-HOST' } };
          const backendNodeId = 5000 + closedRoots.size;
          closedRoots.set(backendNodeId, { frame: owner, level: Number(level) });
          return { node: { localName: 'x-host', nodeName: 'X-HOST', shadowRoots: [{ nodeName: '#document-fragment', shadowRootType: 'closed', backendNodeId }] } };
        }
        if (Number(params.backendNodeId) >= 1000) {
          // A frame's owner element (DOM.getFrameOwner), with the address it names among its attributes.
          const owned = ownerOf(params.backendNodeId, sessionId);
          if (!owned) throw new Error('No node with given id found');
          const tag = owned.ownerTag ?? 'iframe';
          return { node: { localName: tag, nodeName: tag.toUpperCase(), frameId: owned.id, attributes: ['style', 'border:0', tag === 'object' ? 'data' : 'src', owned.src ?? owned.url] } };
        }
        const node = nodes.get(Number(params.backendNodeId));
        if (!node) throw new Error('No node with given id found');
        return { node: { localName: node.localName, nodeName: node.localName.toUpperCase(), ...(node.ownsFrame ? { frameId: node.ownsFrame } : {}) } };
      }
      case 'DOM.resolveNode': {
        const root = closedRoots.get(Number(params.backendNodeId));
        if (!root) throw new Error('No node with given id found');
        if (worlds.get(`${sessionId ?? ''}/${String(params.executionContextId)}`) !== root.frame.id) throw new Error('Cannot find context with specified id');
        return { object: { type: 'object', subtype: 'node', objectId: `root:${root.frame.id}:${root.level}` } };
      }
      case 'DOM.getFrameOwner': {
        /* As Chromium answers: a session finds only the frames of its own
           target, its frame and those inside it at any depth (the page's
           session every frame), and of those only the ones whose owner
           element its process holds; it finds a frame outside them no more
           than one that is gone, and one inside them whose owner another
           process holds (its own frame's among them) belongs to another
           target. */
        const root = sessionId === undefined ? frame(MAIN_FRAME) : frameOfSession(sessionId);
        if (!root) throw new Error('No session with given id');
        const owned = frame(params.frameId);
        let inTarget = false;
        for (let at = owned; at && !inTarget; at = frame(at.parentId)) inTarget = at === root;
        if (!owned || owned.gone || !inTarget) throw new Error('Frame with the given id was not found.');
        if (owned.unplaced || ownerProcess(owned) !== frameOfSession(sessionId)) throw new Error('Frame with the given id does not belong to the target.');
        return { backendNodeId: 1000 + model.frames.indexOf(owned) };
      }
      case 'DOM.getBoxModel': {
        const owned = ownerOf(params.backendNodeId, sessionId);
        if (!owned) throw new Error('Could not find node with given id');
        if (!owned.owner) throw new Error('Could not compute box model.');
        return { model: { content: owned.owner.quad ?? quad(owned.owner.content), border: quad(owned.owner.border) } };
      }
      case 'Page.createIsolatedWorld': {
        const target = frame(params.frameId);
        if (!target || target.gone) throw new Error('No frame for given id found');
        const id = nextWorld++;
        worlds.set(`${sessionId ?? ''}/${id}`, target.id);
        return { executionContextId: id };
      }
      case 'Runtime.evaluate':
      case 'Runtime.callFunctionOn': {
        const context = method === 'Runtime.evaluate' ? params.contextId : params.executionContextId;
        const target = frame(worlds.get(`${sessionId ?? ''}/${String(context)}`));
        if (!target) throw new Error('Cannot find context with specified id');
        const expression = String(method === 'Runtime.evaluate' ? params.expression : params.functionDeclaration);
        if (target.hangs) return new Promise(() => {});
        if (target.throws) return { exceptionDetails: { text: 'Uncaught' }, result: { type: 'object', subtype: 'error' } };
        /* Read from the document, or from inside the closed root at `level` the debugger handed the world. */
        let level = -1;
        if (method === 'Runtime.callFunctionOn') {
          const [argument] = params.arguments as Array<{ objectId?: string }>;
          const root = /^root:(.+):(\d+)$/.exec(argument?.objectId ?? '');
          if (!root || root[1] !== target.id) throw new Error('Argument should belong to the same JavaScript world as target object');
          level = Number(root[2]);
        }
        /* The main frame's document holds the focus on a frame owner when the page says one has it. */
        const onOwner = target.id === MAIN_FRAME && model.focusedOwnerOf ? { ...FOCUS_NONE, otherSite: true } : undefined;
        const focus = (level < 0 ? target.focus ?? onOwner : target.closedRoots?.[level]) ?? FOCUS_NONE;
        const node = (objectId: string | null) => (objectId
          ? { result: { type: 'object', subtype: 'node', objectId } }
          : { result: { type: 'object', subtype: 'null', value: null } });
        if (expression.includes('"kind":"focusedFrame"')) return node(focus.otherSite && model.focusedOwnerOf ? 'focused-owner' : null);
        if (expression.includes('"kind":"focusedElement"')) return node(focus.sealed ? `focus:${target.id}:${level + 1}` : null);
        if (expression.includes('"kind":"focusedEntry"')) return node(target.entry === undefined ? null : `entry:${target.id}:${target.entry}`);
        if (expression.includes('"kind":"focusedNode"')) return node(target.focused === undefined ? null : `focused:${target.id}:${target.focused}`);
        if (expression.includes('"kind":"focusedSecret"')) return { result: { type: 'object', value: focus } };
        const owner = /\{"kind":"frameOwner","path":(\[[\d,]*\]),"url":("(?:[^"\\]|\\.)*")\}/.exec(expression);
        if (owner) {
          const [path, url] = [owner[1], JSON.parse(owner[2]) as string];
          const held = model.frames.find((f) => JSON.stringify(f.path) === path && f.url === url);
          return node(held ? `owner:${held.id}` : null);
        }
        if (expression.includes('"kind":"frameSecret"')) return { result: { type: 'object', value: target.holds === undefined ? false : target.holds } };
        if (expression.includes('"kind":"focusedTyping"')) return { result: { type: 'object', value: { cardNamed: target.cardNamed === true, inControl: target.inControl === true } } };
        if (expression.includes('"kind":"secretBoxes"')) {
          const viewport = target.owner ? { width: target.owner.content.width, height: target.owner.content.height } : SECRETS_NONE.viewport;
          return { result: { type: 'object', value: { ...SECRETS_NONE, viewport, ...target.secrets } } };
        }
        return { exceptionDetails: { text: 'Uncaught' }, result: { type: 'object', subtype: 'error' } };
      }
      default:
        return {};
    }
  };

  const dbg: FakeCdpDebugger = {
    page: model,
    sent: [],
    attaches: 0,
    detaches: 0,
    attach: vi.fn(() => {
      attached = true;
      dbg.attaches += 1;
    }),
    detach: vi.fn(() => {
      attached = false;
      dbg.detaches += 1;
    }),
    isAttached: () => attached,
    /* A plain function, so a test can spy on it and still call it. */
    sendCommand: async (method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
      if (!attached) throw new Error('not attached');
      dbg.sent.push([method, params, sessionId]);
      return answer(method, params, sessionId);
    },
    on: (_event: 'message', listener: Listener) => {
      listeners.push(listener);
      return dbg;
    },
    removeListener: (_event: 'message', listener: Listener) => {
      listeners.splice(listeners.indexOf(listener), 1);
      return dbg;
    },
  };
  return dbg;
}

/** The commands of one method the fake was sent, with their session. */
export const sentOf = (dbg: FakeCdpDebugger, method: string) => dbg.sent.filter(([m]) => m === method).map(([, params, sessionId]) => ({ params, sessionId }));
