/*
 * The agent's input into the in-app browser.
 *
 * Main attaches the view's debugger for one agent step, sends only the
 * Input.* commands below (plus focus emulation, so typing reaches a field while
 * the app's window is in the background), and detaches when the step ends,
 * failures included. It never sends Runtime, Page, Network, Debugger, Console
 * or Log commands, and browser-sessions.ts never runs a step while the person
 * holds the browser, so no debugger is attached during their turn.
 *
 * Input looks like a person's: the mouse moves along an eased, slightly curved
 * path to a random point inside the element, and text is typed key by key
 * (keyDown and keyUp per character) with short pauses. Characters with no key
 * on a US layout go in with Input.insertText.
 *
 * `runStep` turns a checked step into those commands, and refuses typing or
 * key presses into a secret field with 403 password_field.
 */

import {
  BridgeError,
  type MouseButton,
  type StepRequest,
  type StepTarget,
} from '../shared/browser-contract';
import type { LocateResult, SelectResult } from './browser-page-script';
import { screenshotScale } from './browser-screenshot';

/** The only commands main ever sends through a view's debugger. */
export const ALLOWED_CDP_METHODS: ReadonlySet<string> = new Set([
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  'Emulation.setFocusEmulationEnabled',
]);

/** The part of Electron's webContents.debugger this module uses. */
export interface CdpDebugger {
  attach(protocolVersion?: string): void;
  detach(): void;
  isAttached(): boolean;
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

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

const MODIFIER_NAMES: Record<string, Modifier> = {
  alt: 'Alt', option: 'Alt',
  control: 'Control', ctrl: 'Control',
  meta: 'Meta', cmd: 'Meta', command: 'Meta',
  shift: 'Shift',
};

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
  keys.set('\n', { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' });
  keys.set('\t', { key: 'Tab', code: 'Tab', keyCode: 9 });
  return keys;
}

const CHAR_KEYS = buildCharKeys();

const NAMED_KEYS: Record<string, KeyDef> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  return: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};
for (let i = 1; i <= 12; i += 1) NAMED_KEYS[`f${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i };

/* macOS editors run shortcuts as editing commands, which a key event alone
   doesn't trigger. */
const MAC_COMMANDS: Record<string, string> = { a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo' };

export interface KeyPress {
  modifiers: Modifier[];
  key: KeyDef;
}

/** "Enter", "a", "Shift+Tab", "Control+a" or "Meta+Enter" as a key and its modifiers, or null. */
export function parseKeyCombo(combo: string): KeyPress | null {
  const parts = combo.split('+');
  const last = parts.pop();
  if (last === undefined) return null;
  // "Control++" names the plus key.
  const name = last === '' && combo.endsWith('+') ? '+' : last;
  if (last === '' && parts.length && parts[parts.length - 1] === '') parts.pop();
  const modifiers: Modifier[] = [];
  for (const part of parts) {
    const modifier = MODIFIER_NAMES[part.trim().toLowerCase()];
    if (!modifier || modifiers.includes(modifier)) return null;
    modifiers.push(modifier);
  }
  const key = name.length === 1 ? CHAR_KEYS.get(name) : NAMED_KEYS[name.trim().toLowerCase()];
  return key ? { modifiers, key } : null;
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

  async click(at: Point, button: MouseButton, clicks: 1 | 2 | 3): Promise<void> {
    await this.moveTo(at);
    await this.pause(40, 80);
    for (let count = 1; count <= clicks; count += 1) {
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

  async drag(from: Point, to: Point): Promise<void> {
    await this.moveTo(from);
    await this.pause(40, 60);
    await this.mouseEvent('mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 });
    await this.pause(60, 60);
    await this.moveTo(to, 1);
    await this.pause(40, 60);
    await this.mouseEvent('mouseReleased', to, { button: 'left', buttons: 0, clickCount: 1 });
  }

  private keyEvent(type: 'keyDown' | 'rawKeyDown' | 'keyUp', key: KeyDef, modifiers: number, extra: Record<string, unknown> = {}): Promise<unknown> {
    return this.send('Input.dispatchKeyEvent', {
      type,
      key: key.key,
      code: key.code,
      windowsVirtualKeyCode: key.keyCode,
      nativeVirtualKeyCode: key.keyCode,
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

  /** Types `text` key by key; characters with no key go in as inserted text. */
  async typeText(text: string): Promise<void> {
    for (const char of text) {
      const key = CHAR_KEYS.get(char);
      if (key) await this.press({ modifiers: [], key });
      else await this.send('Input.insertText', { text: char });
      await this.pause(35, 90);
    }
  }
}

/**
 * Attaches the debugger, runs one step's input and detaches, whatever happens.
 * Only allow-listed methods are sent. A debugger that is already attached
 * means something else holds it, so the step is refused rather than shared.
 */
export async function withAgentInput<T>(
  dbg: CdpDebugger,
  start: Point,
  pacing: Pacing,
  run: (input: AgentInput) => Promise<T>,
): Promise<{ result: T; mouse: Point }> {
  if (dbg.isAttached()) throw new BridgeError('page_busy', 'the page is busy with another step');
  dbg.attach('1.3');
  try {
    const send = (method: string, params: Record<string, unknown>) => {
      if (!ALLOWED_CDP_METHODS.has(method)) throw new Error(`refused to send ${method} to the page`);
      return dbg.sendCommand(method, params);
    };
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const input = new AgentInput(send, pacing, start);
    const result = await run(input);
    return { result, mouse: input.position };
  } finally {
    if (dbg.isAttached()) dbg.detach();
  }
}

// ---- Steps -----------------------------------------------------------------------

/** The isolated-world reads a step needs (browser-page-script.ts). */
export interface PageReader {
  locate(id: number, reveal: boolean): Promise<LocateResult>;
  focusedSecret(): Promise<boolean>;
  /** Selects the field's text; false when it had none to select. */
  selectContents(id: number): Promise<boolean>;
  select(id: number, values: string[]): Promise<SelectResult>;
  viewport(): Promise<{ width: number; height: number }>;
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
  withInput<T>(run: (input: AgentInput) => Promise<T>): Promise<T>;
}

const stale = (id: number, why: string) => new BridgeError('stale_element', `element ${id} ${why}`);
const secretField = (what: string) => new BridgeError('password_field', `${what} is a secret field; only the person fills it`);

/* A point inside the element, scrolled into view first. The scroll is wheel
   ticks over the page, as a person scrolls; a box that is still out of view
   after that (a scrolled container) is brought in by the page itself. */
async function elementPoint(host: StepHost, input: AgentInput, id: number): Promise<{ at: Point; located: Extract<LocateResult, { found: true }> }> {
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
  const spread = () => 0.3 + host.pacing.random() * 0.4;
  return { at: { x: left + (right - left) * spread(), y: top + (bottom - top) * spread() }, located };
}

async function targetPoint(host: StepHost, input: AgentInput, target: StepTarget, coords: 'page' | 'screenshot'): Promise<Point> {
  if ('element' in target) return (await elementPoint(host, input, target.element)).at;
  const viewport = await host.page.viewport();
  const scale = coords === 'screenshot' ? screenshotScale(viewport.width) : 1;
  const at = { x: target.x * scale, y: target.y * scale };
  if (at.x >= viewport.width || at.y >= viewport.height) {
    throw new BridgeError('bad_request', `the point (${target.x}, ${target.y}) is outside the page's view`);
  }
  return at;
}

const SCROLL_DELTAS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;

/** Runs one checked step. */
export async function runStep(host: StepHost, request: StepRequest): Promise<void> {
  const { step, coords } = request;
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
      if (chosen.reason === 'not_select') throw new BridgeError('bad_request', `element ${step.element} is not a list box; click its option instead`);
      if (chosen.reason === 'single') throw new BridgeError('bad_request', `element ${step.element} takes one value`);
      throw new BridgeError('bad_request', `element ${step.element} has no option ${JSON.stringify(step.values)}; it has ${JSON.stringify(chosen.options ?? [])}`);
    }
    case 'click':
      return host.withInput(async (input) => input.click(await targetPoint(host, input, step.target, coords), step.button, step.clicks));
    case 'hover':
      return host.withInput(async (input) => input.hover(await targetPoint(host, input, step.target, coords)));
    case 'drag':
      return host.withInput(async (input) => {
        const from = await targetPoint(host, input, step.from, coords);
        const to = await targetPoint(host, input, step.to, coords);
        await input.drag(from, to);
      });
    case 'scroll':
      return host.withInput(async (input) => {
        const [sx, sy] = SCROLL_DELTAS[step.direction];
        let at: Point;
        if (step.element !== undefined) {
          at = (await elementPoint(host, input, step.element)).at;
        } else {
          const viewport = await host.page.viewport();
          at = { x: viewport.width / 2, y: viewport.height / 2 };
        }
        await input.wheel(at, sx * step.amount, sy * step.amount);
      });
    case 'type': {
      return host.withInput(async (input) => {
        const { at, located } = await elementPoint(host, input, step.element);
        if (located.secret) throw secretField(`element ${step.element}`);
        await input.click(at, 'left', 1);
        if (await host.page.focusedSecret()) throw secretField('the focused field');
        if (step.clear && await host.page.selectContents(step.element)) {
          await input.press({ modifiers: [], key: parseKeyCombo('Backspace')!.key });
        }
        await input.typeText(step.text);
        if (step.submit) await input.press(parseKeyCombo('Enter')!);
      });
    }
    case 'press': {
      const press = parseKeyCombo(step.key);
      if (!press) throw new BridgeError('bad_request', `unknown key ${JSON.stringify(step.key)}`);
      return host.withInput(async (input) => {
        if (step.element !== undefined) {
          const { at, located } = await elementPoint(host, input, step.element);
          if (located.secret) throw secretField(`element ${step.element}`);
          await input.click(at, 'left', 1);
        }
        if (await host.page.focusedSecret()) throw secretField('the focused field');
        await input.press(press);
      });
    }
  }
}
