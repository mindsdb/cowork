/*
 * The agent's input into the in-app browser.
 *
 * Main attaches the view's debugger for one agent step, sends the Input.*
 * commands below (plus focus emulation, so typing reaches a field while the
 * app's window is in the background) and the reads browser-frames.ts makes,
 * and detaches when the step ends, failures included. browser-sessions.ts
 * never runs a step while the person holds the browser, so no debugger is
 * attached during their turn.
 *
 * Input looks like a person's: the mouse moves along an eased, slightly curved
 * path to a random point inside the element, and text is typed key by key
 * (keyDown and keyUp per character) with short pauses. Characters with no key
 * on a US layout go in with Input.insertText, and so do a tab and a long text
 * past its first KEYED_CHARS characters, so the step ends inside its time
 * limit.
 *
 * `runStep` turns a checked step into those commands. As on the web pod, a
 * type or press step focuses its element rather than clicking it, and a type,
 * a select or a press of a key that edits text into a secret field gets 403
 * password_field. Before every key, typing checks that the focus is still in
 * its field and not on a secret one, and stops when it isn't. A click by
 * number presses only where both the page's hit test and the debugger's,
 * which sees inside closed shadow roots, find its element and no frame. Just
 * before each press, a click or a drag checks its point again, and presses
 * nothing once the page slid a frame or another element under it
 * (`pressPoint`). A press by position, or a drag's release, whose point lands
 * in a frame is refused, at the step's start and just before it, unless anton
 * says the person approved the step to land in one (`frameGuard`).
 */

import {
  BridgeError,
  type MouseButton,
  type StepRequest,
  type StepTarget,
} from '../shared/browser-contract';
import { type CdpDebugger, FrameReads, withDebugger } from './browser-frames';
import type { FocusFieldResult, FocusResult, HitTestResult, LocateResult, SelectResult, TypingFocus } from './browser-page-script';
import { screenshotScale } from './browser-screenshot';

/** Waiting and randomness, injected so tests run fast and repeatably. */
export interface Pacing {
  sleep(ms: number): Promise<void>;
  random(): number;
}

export const realPacing: Pacing = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

export interface Point {
  x: number;
  y: number;
}

// ---- Keys --------------------------------------------------------------------

interface KeyDef {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
  shift?: boolean;
}

const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const;
type Modifier = keyof typeof MODIFIER_BITS;

const MODIFIER_KEYS: Record<Modifier, KeyDef> = {
  Alt: { key: 'Alt', code: 'AltLeft', keyCode: 18 },
  Control: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  Meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
  Shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
};

function isModifier(name: string): name is Modifier {
  return Object.hasOwn(MODIFIER_BITS, name);
}

/* A US layout: every character a person types with one key, with or without Shift. */
function buildCharKeys(): Map<string, KeyDef> {
  const keys = new Map<string, KeyDef>();
  for (let i = 0; i < 26; i += 1) {
    const lower = String.fromCharCode(97 + i);
    const upper = lower.toUpperCase();
    const code = `Key${upper}`;
    keys.set(lower, { key: lower, code, keyCode: 65 + i, text: lower });
    keys.set(upper, { key: upper, code, keyCode: 65 + i, text: upper, shift: true });
  }
  const shiftedDigits = ')!@#$%^&*(';
  for (let i = 0; i < 10; i += 1) {
    keys.set(String(i), { key: String(i), code: `Digit${i}`, keyCode: 48 + i, text: String(i) });
    keys.set(shiftedDigits[i], { key: shiftedDigits[i], code: `Digit${i}`, keyCode: 48 + i, text: shiftedDigits[i], shift: true });
  }
  const pairs: Array<[string, string, string, number]> = [
    ['-', '_', 'Minus', 189], ['=', '+', 'Equal', 187], ['[', '{', 'BracketLeft', 219],
    [']', '}', 'BracketRight', 221], ['\\', '|', 'Backslash', 220], [';', ':', 'Semicolon', 186],
    ["'", '"', 'Quote', 222], [',', '<', 'Comma', 188], ['.', '>', 'Period', 190],
    ['/', '?', 'Slash', 191], ['`', '~', 'Backquote', 192],
  ];
  for (const [plain, shifted, code, keyCode] of pairs) {
    keys.set(plain, { key: plain, code, keyCode, text: plain });
    keys.set(shifted, { key: shifted, code, keyCode, text: shifted, shift: true });
  }
  keys.set(' ', { key: ' ', code: 'Space', keyCode: 32, text: ' ' });
  return keys;
}

const CHAR_KEYS = buildCharKeys();

const ENTER: KeyDef = { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' };
const TAB: KeyDef = { key: 'Tab', code: 'Tab', keyCode: 9 };
const BACKSPACE: KeyDef = { key: 'Backspace', code: 'Backspace', keyCode: 8 };

const NAMED_KEYS: KeyDef[] = [
  ENTER,
  TAB,
  BACKSPACE,
  { key: 'Escape', code: 'Escape', keyCode: 27 },
  { key: 'Delete', code: 'Delete', keyCode: 46 },
  { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  { key: 'Home', code: 'Home', keyCode: 36 },
  { key: 'End', code: 'End', keyCode: 35 },
  { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  { key: 'PageDown', code: 'PageDown', keyCode: 34 },
];
for (let i = 1; i <= 12; i += 1) NAMED_KEYS.push({ key: `F${i}`, code: `F${i}`, keyCode: 111 + i });

/* The keys a press names, spelled exactly as KeyboardEvent.key spells them: a
   character a US layout types with one key, or a named key. The web pod reads
   the same names, so a spelling it refuses ("Return", "esc", "ctrl+a") is
   refused here too. */
const KEYS: ReadonlyMap<string, KeyDef> = new Map([...CHAR_KEYS, ...NAMED_KEYS.map((def): [string, KeyDef] => [def.key, def])]);

/* What typed text sends: each character's key, and Enter for a line break. A
   tab goes in as text, as on the web pod, so typing never moves the focus
   with Tab. */
const TYPED_KEYS: ReadonlyMap<string, KeyDef> = new Map([...CHAR_KEYS, ['\n', ENTER]]);

/* A type step's first characters go in key by key; past them, the text is
   inserted in chunks, with no pauses. 100 keys pause for about 13.5 s and at
   most 20.5 s, so even the longest text the contract takes ends inside
   STEP_TIMEOUT_MS (src/shared/browser-contract.ts), the host's budget for a
   step, which itself ends inside anton's wait for the answer. */
export const KEYED_CHARS = 100;
const INSERTED_CHUNK_CHARS = 40;

/* macOS editors run shortcuts as editing commands, which a key event alone
   doesn't trigger. Paste has none: runStep refuses the paste shortcuts. */
const MAC_COMMANDS: Record<string, string> = { a: 'selectAll', c: 'copy', x: 'cut', z: 'undo' };

export interface KeyPress {
  modifiers: Modifier[];
  key: KeyDef;
}

/** "Enter", "a", "Shift+Tab", "Control+a" or "Meta+Enter" as a key and its
    modifiers (Alt, Control, Meta, Shift), or null. Names are matched exactly,
    as the web pod's parseChord matches them. */
export function parseKeyCombo(combo: string): KeyPress | null {
  // "Control++" names the plus key.
  const parts = combo.endsWith('++') ? [...combo.slice(0, -2).split('+').filter(Boolean), '+'] : combo.split('+');
  const name = parts.pop();
  const key = name === undefined ? undefined : KEYS.get(name);
  if (!key) return null;
  const modifiers: Modifier[] = [];
  for (const part of parts) {
    if (!isModifier(part) || modifiers.includes(part)) return null;
    modifiers.push(part);
  }
  return { modifiers, key };
}

/* Whether pressing it puts text into a field or takes it out: its key types a
   character (Enter aside) or is Backspace or Delete, whatever modifiers are
   held, since Control+X cuts. Enter, Tab, Escape, the arrows and the other
   keys that move or submit don't. The web pod's editsText rule. */
function editsText(press: KeyPress): boolean {
  if (press.key.key === 'Backspace' || press.key.key === 'Delete') return true;
  return Boolean(press.key.text) && press.key.key !== 'Enter';
}

/* The paste shortcuts. The agent types its own text and never needs the
   person's OS clipboard, which may hold a password they just pasted. Insert
   is not a key here, so Shift+Insert, the other paste shortcut outside macOS,
   is refused as an unknown key. */
function pastes(press: KeyPress): boolean {
  const shortcut = press.modifiers.includes('Control') || press.modifiers.includes('Meta');
  return shortcut && press.key.key.toLowerCase() === 'v';
}

// ---- Input ---------------------------------------------------------------------

const BUTTON_BITS: Record<MouseButton, number> = { left: 1, right: 2, middle: 4 };

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** One step's input, sent through an attached debugger. */
export class AgentInput {
  private mouse: Point;

  constructor(
    private readonly send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
    private readonly pacing: Pacing,
    start: Point,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    this.mouse = { ...start };
  }

  get position(): Point {
    return { ...this.mouse };
  }

  private pause(minMs: number, spreadMs: number): Promise<void> {
    return this.pacing.sleep(minMs + this.pacing.random() * spreadMs);
  }

  private mouseEvent(type: string, at: Point, extra: Record<string, unknown>): Promise<unknown> {
    return this.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, pointerType: 'mouse', ...extra });
  }

  /** Moves along an eased curve from where the mouse is to `to`. */
  async moveTo(to: Point, buttons = 0): Promise<void> {
    const from = this.mouse;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= 1) {
      const steps = Math.max(5, Math.min(28, Math.round(distance / 35)));
      const bend = (this.pacing.random() - 0.5) * Math.min(80, distance * 0.2);
      const nx = -dy / distance;
      const ny = dx / distance;
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const eased = easeInOutCubic(t);
        const arc = i === steps ? 0 : Math.sin(Math.PI * t) * bend;
        const at = { x: from.x + dx * eased + nx * arc, y: from.y + dy * eased + ny * arc };
        await this.mouseEvent('mouseMoved', at, { button: buttons ? 'left' : 'none', buttons });
        await this.pause(6, 10);
      }
    }
    this.mouse = { ...to };
  }

  /** Moves to `at` and clicks there. `beforePress` runs just before each
      press, and stops the click by throwing. */
  async click(at: Point, button: MouseButton, clicks: 1 | 2 | 3, beforePress: () => Promise<void> = async () => {}): Promise<void> {
    await this.moveTo(at);
    await this.pause(40, 80);
    for (let count = 1; count <= clicks; count += 1) {
      await beforePress();
      await this.mouseEvent('mousePressed', at, { button, buttons: BUTTON_BITS[button], clickCount: count });
      await this.pause(50, 60);
      await this.mouseEvent('mouseReleased', at, { button, buttons: 0, clickCount: count });
      if (count < clicks) await this.pause(60, 60);
    }
  }

  async hover(at: Point): Promise<void> {
    await this.moveTo(at);
  }

  /** Wheel ticks at `at`, about 120 px each, as a mouse wheel sends them. */
  async wheel(at: Point, deltaX: number, deltaY: number): Promise<void> {
    await this.moveTo(at);
    const ticks = Math.max(1, Math.ceil(Math.max(Math.abs(deltaX), Math.abs(deltaY)) / 120));
    for (let i = 0; i < ticks; i += 1) {
      await this.mouseEvent('mouseWheel', at, { button: 'none', buttons: 0, deltaX: deltaX / ticks, deltaY: deltaY / ticks });
      await this.pause(16, 30);
    }
  }

  /** Presses at `from`, moves to `to` with the button held and releases.
      `beforePress` runs just before the press and `beforeRelease` just
      before the release, and each stops the drag by throwing. Stopped before
      the release, the pointer goes back to `from` and lets go there, as a
      person calls a drag off, so the button is never left held (the web
      pod's drag does the same). */
  async drag(from: Point, to: Point, beforePress: () => Promise<void> = async () => {}, beforeRelease: () => Promise<void> = async () => {}): Promise<void> {
    await this.moveTo(from);
    await this.pause(40, 60);
    await beforePress();
    await this.mouseEvent('mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 });
    await this.pause(60, 60);
    await this.moveTo(to, 1);
    await this.pause(40, 60);
    try {
      await beforeRelease();
    } catch (error) {
      await this.moveTo(from, 1);
      await this.mouseEvent('mouseReleased', from, { button: 'left', buttons: 0, clickCount: 1 });
      throw error;
    }
    await this.mouseEvent('mouseReleased', to, { button: 'left', buttons: 0, clickCount: 1 });
  }

  private keyEvent(type: 'keyDown' | 'rawKeyDown' | 'keyUp', key: KeyDef, modifiers: number, extra: Record<string, unknown> = {}): Promise<unknown> {
    /* No nativeVirtualKeyCode: without one Chromium marks the key
       skip_if_unhandled, so a key the page leaves alone never reaches the app
       menu, where Control+W closes the window and Control+Q quits on Linux. */
    return this.send('Input.dispatchKeyEvent', {
      type,
      key: key.key,
      code: key.code,
      windowsVirtualKeyCode: key.keyCode,
      modifiers,
      ...extra,
    });
  }

  /** One key with its modifiers held, as a person presses it. */
  async press(press: KeyPress): Promise<void> {
    const held = [...press.modifiers];
    if (press.key.shift && !held.includes('Shift')) held.push('Shift');
    let bits = 0;
    for (const modifier of held) {
      bits |= MODIFIER_BITS[modifier];
      await this.keyEvent('rawKeyDown', MODIFIER_KEYS[modifier], bits);
    }
    const shortcut = held.includes('Control') || held.includes('Meta') || held.includes('Alt');
    const text = shortcut ? undefined : press.key.text;
    const extra: Record<string, unknown> = text ? { text, unmodifiedText: text } : {};
    const command = this.platform === 'darwin' && held.includes('Meta') ? MAC_COMMANDS[press.key.key.toLowerCase()] : undefined;
    if (command) extra.commands = [command];
    await this.keyEvent(text ? 'keyDown' : 'rawKeyDown', press.key, bits, extra);
    await this.pause(30, 50);
    await this.keyEvent('keyUp', press.key, bits);
    for (const modifier of held.reverse()) {
      bits &= ~MODIFIER_BITS[modifier];
      await this.keyEvent('keyUp', MODIFIER_KEYS[modifier], bits);
    }
  }

  /**
   * Types `text`: its first KEYED_CHARS characters key by key, a character
   * with no key as inserted text, and the rest inserted INSERTED_CHUNK_CHARS
   * at a time. `beforeKey` runs before each key and each chunk, and stops the
   * typing by throwing.
   */
  async typeText(text: string, beforeKey: () => Promise<void>): Promise<void> {
    const chars = [...text];
    for (const char of chars.slice(0, KEYED_CHARS)) {
      await beforeKey();
      const key = TYPED_KEYS.get(char);
      if (key) await this.press({ modifiers: [], key });
      else await this.send('Input.insertText', { text: char });
      await this.pause(35, 90);
    }
    for (let at = KEYED_CHARS; at < chars.length; at += INSERTED_CHUNK_CHARS) {
      await beforeKey();
      await this.send('Input.insertText', { text: chars.slice(at, at + INSERTED_CHUNK_CHARS).join('') });
    }
  }
}

/**
 * Attaches the debugger, runs one step's input and the reads it needs
 * (browser-frames.ts), and detaches, whatever happens (withDebugger). Only
 * allow-listed methods are sent. A debugger that is already attached means
 * something else holds it, so the step is refused rather than shared.
 */
export async function withAgentInput<T>(
  dbg: CdpDebugger,
  start: Point,
  pacing: Pacing,
  run: (input: AgentInput, frames: FrameReads) => Promise<T>,
): Promise<{ result: T; mouse: Point }> {
  return withDebugger(dbg, async (session) => {
    const send = (method: string, params: Record<string, unknown>) => session.send(method, params);
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const input = new AgentInput(send, pacing, start);
    const result = await run(input, new FrameReads(session));
    return { result, mouse: input.position };
  });
}

// ---- Steps -----------------------------------------------------------------------

/** The isolated-world reads a step needs (browser-page-script.ts). */
export interface PageReader {
  locate(id: number, reveal: boolean): Promise<LocateResult>;
  focusedSecret(): Promise<boolean>;
  /** Where the focus is while a type step types into element `id`. */
  typingFocus(id: number): Promise<TypingFocus>;
  /** Focuses text field `id` for typing; with `select`, selects its text so typing replaces it. */
  focusField(id: number, select: boolean): Promise<FocusFieldResult>;
  /** Focuses element `id` for a key press, unless the focus is in it already. */
  focus(id: number, editing: boolean): Promise<FocusResult>;
  select(id: number, values: string[]): Promise<SelectResult>;
  viewport(): Promise<{ width: number; height: number }>;
  /** Which of `points` a click reaches element `id` at. */
  hitTest(id: number, points: Point[]): Promise<HitTestResult>;
}

export interface Navigation {
  load(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
}

export interface StepHost {
  page: PageReader;
  nav: Navigation;
  pacing: Pacing;
  /** Runs `run` with the debugger attached for this one step. */
  withInput<T>(run: (input: AgentInput, frames: FrameReads) => Promise<T>): Promise<T>;
}

const stale = (id: number, why: string) => new BridgeError('stale_element', `element ${id} ${why}`);
const secretField = (what: string) => new BridgeError('password_field', `${what} is a secret field; only the person fills it`);

/* Why the page didn't focus element `id` for keys. */
function focusRefused(id: number, reason: Extract<FocusFieldResult, { ok: false }>['reason']): BridgeError {
  switch (reason) {
    case 'not_found':
      return stale(id, 'is no longer on the page');
    case 'secret':
      return secretField(`element ${id}`);
    case 'not_text':
      return new BridgeError('bad_request', `element ${id} is not a text field`);
    case 'unfocusable':
      return stale(id, "can't take the focus, so its keys would go elsewhere; it may be disabled or hidden");
  }
}

/* The points a click by number tries after its random one, as fractions of
   the element's visible box from its middle: the middle, then the same points
   out toward the edges every time, as on the web pod. */
const FIXED_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [-0.25, 0], [0.25, 0], [0, -0.25], [0, 0.25], [-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4],
];

/* Why no point of a click by number reaches its element: a frame inside it
   (or a part of the page the isolated world can't read) takes the click, or
   something covers it (a dialog, a banner, a frame laid over it). */
function unreached(id: number, intoFrame: boolean): BridgeError {
  return intoFrame
    ? stale(id, "holds a frame, or a part of the page this browser can't read, where a click by number would land; click inside it by position from a screenshot")
    : stale(id, 'is covered by another element, such as a dialog or banner; deal with that first, or take a screenshot');
}

/* The first of `points` a click reaches element `id` at: the page's hit test
   lands on the element there (`hitTest`), and the debugger's, which sees
   inside closed shadow roots, finds no frame there (`pressLandsInFrame`). A
   control that slots its own text over a frame in its closed shadow root
   reads to the page's hit test as the control, at every point. When no point
   reaches it, the step is refused rather than pressing what lies there
   (`unreached`). A `wheel` may land in a frame inside the element, since a
   wheel activates nothing there. */
async function reachingPoint(host: StepHost, frames: FrameReads, id: number, points: Point[], wheel: boolean): Promise<Point> {
  let intoFrame = false;
  for (let from = 0; from < points.length;) {
    const hit = await host.page.hitTest(id, points.slice(from));
    if (!hit.found) throw stale(id, 'is no longer on the page');
    intoFrame ||= hit.throughFrame >= 0;
    if (hit.reaches < 0) {
      if (wheel && hit.throughFrame >= 0) return points[from + hit.throughFrame];
      break;
    }
    const at = points[from + hit.reaches];
    if (wheel || !(await frames.pressLandsInFrame(at))) return at;
    intoFrame = true;
    from += hit.reaches + 1;
  }
  throw unreached(id, intoFrame);
}

/* A point inside the element, scrolled into view first. The scroll is wheel
   ticks over the page, as a person scrolls; a box that is still out of view
   after that (a scrolled container) is brought in by the page itself. The
   point is a random one, as a person clicks, or else the first fixed point
   that reaches the element (`reachingPoint`). */
async function elementPoint(
  host: StepHost,
  input: AgentInput,
  frames: FrameReads,
  id: number,
  wheel = false,
): Promise<{ at: Point; located: Extract<LocateResult, { found: true }> }> {
  let located = await host.page.locate(id, false);
  for (let round = 0; round < 3 && located.found && located.shown && !located.inViewport; round += 1) {
    const { box, viewport } = located;
    const center = { x: viewport.width / 2, y: viewport.height / 2 };
    await input.wheel(center, box.x + box.width / 2 - center.x, box.y + box.height / 2 - center.y);
    await host.pacing.sleep(150);
    located = await host.page.locate(id, false);
  }
  if (located.found && located.shown && !located.inViewport) located = await host.page.locate(id, true);
  if (!located.found) throw stale(id, 'is no longer on the page');
  if (!located.shown) throw stale(id, 'is not visible');
  const { box, viewport } = located;
  const left = Math.max(box.x, 0);
  const top = Math.max(box.y, 0);
  const right = Math.min(box.x + box.width, viewport.width);
  const bottom = Math.min(box.y + box.height, viewport.height);
  if (right <= left || bottom <= top) throw stale(id, 'is outside the view');
  const width = right - left;
  const height = bottom - top;
  const spread = () => 0.3 + host.pacing.random() * 0.4;
  const points: Point[] = [
    { x: left + width * spread(), y: top + height * spread() },
    ...FIXED_POINTS.map(([dx, dy]) => ({ x: left + width * (0.5 + dx), y: top + height * (0.5 + dy) })),
  ];
  return { at: await reachingPoint(host, frames, id, points, wheel), located };
}

async function targetPoint(host: StepHost, input: AgentInput, frames: FrameReads, target: StepTarget, coords: 'page' | 'screenshot'): Promise<Point> {
  if ('element' in target) return (await elementPoint(host, input, frames, target.element)).at;
  const viewport = await host.page.viewport();
  const scale = coords === 'screenshot' ? screenshotScale(viewport.width) : 1;
  const at = { x: target.x * scale, y: target.y * scale };
  if (at.x >= viewport.width || at.y >= viewport.height) {
    throw new BridgeError('bad_request', `the point (${target.x}, ${target.y}) is outside the page's view`);
  }
  return at;
}

/* Why a press was not sent: something arrived under its point while the
   pointer glided there. */
function movedUnder(where: string, intoFrame: boolean): BridgeError {
  return new BridgeError('stale_element', `${intoFrame ? 'a frame' : 'another element'} moved ${where} as the pointer arrived, so nothing was pressed; read the page again`);
}

/* The check a press, or a drag's release, at a point runs when the step
   starts, and the one it hands back to run just before. anton's commit hold
   judged the step by the frames its last page read showed, and a frame can
   arrive under the point after that read: the page moves one there, or the
   person scrolls. A step anton sends with into_frame (`intoFrame`: the person
   approved a step that may land in a frame) may press into a frame that lies
   there when it starts. Any other press or release whose point lands in a
   frame is refused, at the start and just before it; so is one where a frame
   arrived during the glide. `where` names the point. */
async function frameGuard(frames: FrameReads, at: Point, intoFrame: boolean, where: string): Promise<() => Promise<void>> {
  const atStart = await frames.pressLandsInFrame(at);
  if (atStart && !intoFrame) {
    throw new BridgeError('stale_element', `a frame is now under ${where}, and the step wasn't approved to press into one, so nothing was pressed; read the page again`);
  }
  return async () => {
    if (!atStart && await frames.pressLandsInFrame(at)) throw movedUnder(`under ${where}`, true);
  };
}

/* A step's press point, and the check that runs just before each press there.
   The pointer glides for a while and the page sees it come, so the page can
   slide something under the point after the step's first look. The commit
   hold judged the step by what lay there before. A click by number must still
   reach its element at the point, and never land in a frame (`hitTest`,
   `pressLandsInFrame`); a click by position goes by `frameGuard`. */
async function pressPoint(
  host: StepHost,
  input: AgentInput,
  frames: FrameReads,
  target: StepTarget,
  coords: 'page' | 'screenshot',
  intoFrame: boolean,
): Promise<{ at: Point; beforePress: () => Promise<void> }> {
  if ('element' in target) {
    const id = target.element;
    const { at } = await elementPoint(host, input, frames, id);
    return {
      at,
      beforePress: async () => {
        const hit = await host.page.hitTest(id, [at]);
        if (!hit.found) throw stale(id, 'is no longer on the page');
        const inFrame = hit.throughFrame >= 0 || await frames.pressLandsInFrame(at);
        if (hit.reaches < 0 || inFrame) throw movedUnder(`over element ${id}`, inFrame);
      },
    };
  }
  const at = await targetPoint(host, input, frames, target, coords);
  return { at, beforePress: await frameGuard(frames, at, intoFrame, `the point (${target.x}, ${target.y})`) };
}

const SCROLL_DELTAS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;

/** Runs one checked step. */
export async function runStep(host: StepHost, request: StepRequest, platform: NodeJS.Platform = process.platform): Promise<void> {
  const { step, coords, intoFrame } = request;
  switch (step.action) {
    case 'navigate':
      return host.nav.load(step.url);
    case 'back':
      return host.nav.back();
    case 'forward':
      return host.nav.forward();
    case 'reload':
      return host.nav.reload();
    case 'wait':
      return host.pacing.sleep(step.ms);
    case 'select': {
      const chosen = await host.page.select(step.element, step.values);
      if (chosen.ok) return;
      if (chosen.reason === 'not_found') throw stale(step.element, 'is no longer on the page');
      if (chosen.reason === 'secret') throw secretField(`element ${step.element}`);
      if (chosen.reason === 'not_select') throw new BridgeError('bad_request', `element ${step.element} is not a list box; click its option instead`);
      if (chosen.reason === 'single') throw new BridgeError('bad_request', `element ${step.element} takes one value`);
      throw new BridgeError('bad_request', `element ${step.element} has no option ${JSON.stringify(step.values)}; it has ${JSON.stringify(chosen.options ?? [])}`);
    }
    case 'click':
      /* Outside macOS and Windows, Chromium pastes the primary selection on a
         middle click: the text the person last selected in any app, which the
         page and the next read would pass to the agent. */
      if (step.button === 'middle' && platform !== 'darwin' && platform !== 'win32') {
        throw new BridgeError('bad_request', "the agent can't paste the person's selection, which a middle click does on Linux; click with the left or right button");
      }
      return host.withInput(async (input, frames) => {
        const { at, beforePress } = await pressPoint(host, input, frames, step.target, coords, intoFrame);
        await input.click(at, step.button, step.clicks, beforePress);
      });
    case 'hover':
      return host.withInput(async (input, frames) => input.hover(await targetPoint(host, input, frames, step.target, coords)));
    case 'drag':
      return host.withInput(async (input, frames) => {
        const from = await pressPoint(host, input, frames, step.from, coords, intoFrame);
        const to = await targetPoint(host, input, frames, step.to, coords);
        const where = 'element' in step.to ? `the drop point on element ${step.to.element}` : `the drop point (${step.to.x}, ${step.to.y})`;
        const beforeRelease = await frameGuard(frames, to, intoFrame, where);
        await input.drag(from.at, to, from.beforePress, beforeRelease);
      });
    case 'scroll':
      return host.withInput(async (input, frames) => {
        const [sx, sy] = SCROLL_DELTAS[step.direction];
        let at: Point;
        if (step.element !== undefined) {
          at = (await elementPoint(host, input, frames, step.element, true)).at;
        } else {
          const viewport = await host.page.viewport();
          at = { x: viewport.width / 2, y: viewport.height / 2 };
        }
        await input.wheel(at, sx * step.amount, sy * step.amount);
      });
    case 'type':
      return host.withInput(async (input) => {
        const field = await host.page.focusField(step.element, step.clear);
        if (!field.ok) throw focusRefused(step.element, field.reason);
        /* Before every key: typing stops once the focus is on a secret field
           or has left this one, whether a typed line break moved it or the
           page did, so no key goes anywhere the step didn't name. */
        const keepTyping = async () => {
          const focus = await host.page.typingFocus(step.element);
          if (focus.secret) throw secretField('the focused field');
          if (!focus.inField) {
            throw new BridgeError('stale_element', `the focus left element ${step.element}, so the rest was not typed; read the page again`);
          }
        };
        if (field.selected) {
          await keepTyping();
          await input.press({ modifiers: [], key: BACKSPACE });
        }
        await input.typeText(step.text, keepTyping);
        if (step.submit) {
          await keepTyping();
          await input.press({ modifiers: [], key: ENTER });
        }
      });
    case 'press': {
      const press = parseKeyCombo(step.key);
      if (!press) {
        throw new BridgeError('bad_request', `unknown key ${JSON.stringify(step.key)}; name keys as KeyboardEvent.key does, such as "Enter", "ArrowDown" or "Control+a"`);
      }
      if (pastes(press)) throw new BridgeError('bad_request', "the agent can't paste the person's clipboard; type the text instead");
      const editing = editsText(press);
      return host.withInput(async (input) => {
        if (step.element !== undefined) {
          const focus = await host.page.focus(step.element, editing);
          if (!focus.ok) throw focusRefused(step.element, focus.reason);
        }
        if (editing && await host.page.focusedSecret()) throw secretField('the focused field');
        await input.press(press);
      });
    }
  }
}
