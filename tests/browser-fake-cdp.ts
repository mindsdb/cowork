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
  /** Where the focus is, as the frame's own world reads it. */
  focus?: FocusedSecret;
  /** What the frame's own world finds for a screenshot, in its own viewport's pixels. */
  secrets?: Partial<FoundSecrets>;
  /** The frame's owner element in the page: its content and border boxes in
      the page's viewport, or null when it draws nothing. */
  owner?: { content: Box; border: Box } | null;
  /** The frame's world never answers. */
  hangs?: boolean;
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
  /** The node at viewport point (x, y). The default is a button of the main frame. */
  nodeAt?: (x: number, y: number) => FakeNode | null;
  /** The frame the owner holding the focus holds, when the page's focus rests on one. */
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

const SECRETS_NONE: FoundSecrets = { secrets: [], paymentFrames: [], otherSiteFrames: [], owners: 0, viewport: { width: 400, height: 100 } };

/** A plain page at https://a.test/ with a button everywhere and no frames, unless `page` says otherwise. */
export function fakeCdpDebugger(page: Partial<FakeCdpPage> = {}): FakeCdpDebugger {
  const model: FakeCdpPage = {
    frames: [{ id: MAIN_FRAME, url: 'https://a.test/', parentId: null, origin: 'https://a.test' }, ...(page.frames ?? [])],
    nodeAt: page.nodeAt,
    focusedOwnerOf: page.focusedOwnerOf ?? null,
    scroll: page.scroll ?? { x: 0, y: 0 },
  };
  let attached = false;
  let nextWorld = 1;
  const worlds = new Map<string, string>();
  const nodes = new Map<number, FakeNode>();
  const listeners: Listener[] = [];
  const sessionOf = (frame: FakeFrame) => `session-${frame.id}`;
  const frameOfSession = (sessionId: string | undefined) => model.frames.find((f) => f.remote && sessionOf(f) === sessionId);
  const frame = (id: unknown) => model.frames.find((f) => f.id === id);
  const tree = (root: FakeFrame): unknown => ({
    frame: { id: root.id, url: root.url, ...(root.parentId ? { parentId: root.parentId } : {}), securityOrigin: root.origin ?? new URL(root.url).origin },
    childFrames: model.frames.filter((f) => f.parentId === root.id && !f.remote).map(tree),
  });

  const answer = (method: string, params: Record<string, unknown>, sessionId: string | undefined): unknown => {
    switch (method) {
      case 'Target.setAutoAttach':
        for (const remote of model.frames.filter((f) => f.remote)) {
          const event = { sessionId: sessionOf(remote), targetInfo: { targetId: remote.id, type: 'iframe', url: remote.url, parentFrameId: remote.parentId } };
          for (const listener of listeners) listener({}, 'Target.attachedToTarget', event, sessionId ?? '');
        }
        return {};
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
        const node = nodes.get(Number(params.backendNodeId));
        if (!node) throw new Error('No node with given id found');
        return { node: { localName: node.localName, nodeName: node.localName.toUpperCase(), ...(node.ownsFrame ? { frameId: node.ownsFrame } : {}) } };
      }
      case 'DOM.getFrameOwner': {
        const owned = frame(params.frameId);
        if (!owned) throw new Error('Frame with the given id was not found.');
        return { backendNodeId: 1000 + model.frames.indexOf(owned) };
      }
      case 'DOM.getBoxModel': {
        const owned = model.frames[Number(params.backendNodeId) - 1000];
        if (!owned?.owner) throw new Error('Could not compute box model.');
        return { model: { content: quad(owned.owner.content), border: quad(owned.owner.border) } };
      }
      case 'Page.createIsolatedWorld': {
        const target = frame(params.frameId);
        if (!target) throw new Error('No frame for given id found');
        const id = nextWorld++;
        worlds.set(`${sessionId ?? ''}/${id}`, target.id);
        return { executionContextId: id };
      }
      case 'Runtime.evaluate': {
        const target = frame(worlds.get(`${sessionId ?? ''}/${String(params.contextId)}`));
        if (!target) throw new Error('Cannot find context with specified id');
        const expression = String(params.expression);
        if (target.hangs) return new Promise(() => {});
        if (expression.includes('"kind":"focusedFrame"')) {
          return model.focusedOwnerOf
            ? { result: { type: 'object', subtype: 'node', objectId: 'focused-owner' } }
            : { result: { type: 'object', subtype: 'null', value: null } };
        }
        if (expression.includes('"kind":"focusedSecret"')) return { result: { type: 'object', value: target.focus ?? { secret: false, otherSite: false } } };
        if (expression.includes('"kind":"secretBoxes"')) return { result: { type: 'object', value: { ...SECRETS_NONE, ...target.secrets } } };
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
