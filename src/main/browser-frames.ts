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
 * Every command goes out through `DebuggerSession.send`, which checks it
 * first: only the methods in ALLOWED_CDP_METHODS. Nothing here sends
 * Runtime.enable, Page.enable, Network, Debugger, Console or Log commands,
 * which make Chromium report to the protocol in ways a page can notice.
 */

import { BridgeError } from '../shared/browser-contract';
import type { ViewPoint } from './browser-page-script';

/** The only commands main ever sends through a view's debugger. */
export const ALLOWED_CDP_METHODS: ReadonlySet<string> = new Set([
  // A step's input (browser-input.ts).
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  'Emulation.setFocusEmulationEnabled',
  // Where a press lands (FrameReads).
  'Page.getFrameTree',
  'Page.getLayoutMetrics',
  'DOM.getNodeForLocation',
  'DOM.describeNode',
]);

/** The part of Electron's webContents.debugger this module uses. */
export interface CdpDebugger {
  attach(protocolVersion?: string): void;
  detach(): void;
  isAttached(): boolean;
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

interface FrameTree {
  frame: { id: string };
}

/** One attach of the debugger, and the checks every command passes. */
export class DebuggerSession {
  private main: Promise<string> | null = null;

  constructor(private readonly dbg: CdpDebugger) {}

  /** Sends `method` once it passes the checks, and refuses it otherwise. */
  async send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!ALLOWED_CDP_METHODS.has(method)) throw new Error(`refused to send ${method} to the page`);
    return (await this.dbg.sendCommand(method, params)) as T;
  }

  /** The page's main frame's id, asked once per attach. */
  mainFrame(): Promise<string> {
    this.main ??= this.send<{ frameTree: FrameTree }>('Page.getFrameTree').then(({ frameTree }) => frameTree.frame.id);
    return this.main;
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
  try {
    return await run(new DebuggerSession(dbg));
  } finally {
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
}
