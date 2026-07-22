// Trusted input for canvas-rendered apps (Google Sheets, Docs, Figma…) via
// the Chrome DevTools Protocol on the tab's webContents. Synthetic DOM events
// (el.click(), KeyboardEvent) are isTrusted:false and many canvas apps ignore
// them; CDP Input.* events are indistinguishable from real user input.
//
// The key/modifier resolution is pure (unit-tested); the transport is a thin
// wrapper over webContents.debugger, attached lazily and kept attached.

import type { WebContents } from 'electron';

// ---------------------------------------------------------------------------
// Pure key/modifier model
// ---------------------------------------------------------------------------

export interface KeySpec {
  key: string; // DOM KeyboardEvent.key ('Enter', 'a', 'ArrowLeft')
  code: string; // DOM KeyboardEvent.code ('Enter', 'KeyA', 'ArrowLeft')
  windowsVirtualKeyCode: number;
}

const NAMED_KEYS: Record<string, KeySpec> = {
  enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
  return: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
  tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  del: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  up: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  right: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  down: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
  end: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
  pgup: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
  pgdn: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
  space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
};

/** Resolve a key name to its CDP descriptor. Accepts named keys ('enter',
 *  'arrowleft', …) case-insensitively, or a single printable character
 *  ('a', 'Z', '1', '?'). Returns null for anything else. */
export function resolveKey(name: string): KeySpec | null {
  if (typeof name !== 'string' || name.length === 0) return null;
  const named = NAMED_KEYS[name.trim().toLowerCase()];
  if (named) return named;
  if (name.length === 1) {
    const ch = name;
    const upper = ch.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') {
      return { key: ch, code: `Key${upper}`, windowsVirtualKeyCode: upper.charCodeAt(0) };
    }
    if (ch >= '0' && ch <= '9') {
      return { key: ch, code: `Digit${ch}`, windowsVirtualKeyCode: ch.charCodeAt(0) };
    }
    // Other printable characters: no portable code, but key + vk 0 still
    // deliver the character through keypress-less paths; keep vk at 0.
    return { key: ch, code: '', windowsVirtualKeyCode: 0 };
  }
  return null;
}

const MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  ctrl: 2,
  control: 2,
  cmd: 4,
  meta: 4,
  command: 4,
  shift: 8,
};

/** CDP modifier bitmask from names like ['cmd'], ['ctrl','shift']. */
export function parseModifiers(mods?: string[]): number {
  if (!Array.isArray(mods)) return 0;
  let mask = 0;
  for (const m of mods) {
    const bit = MODIFIER_BITS[String(m).toLowerCase()];
    if (bit) mask |= bit;
  }
  return mask;
}

// ---------------------------------------------------------------------------
// CDP transport (webContents.debugger)
// ---------------------------------------------------------------------------

const DEBUGGER_PROTOCOL = '1.3';

async function cdpSend(wc: WebContents, method: string, params: Record<string, unknown>): Promise<unknown> {
  const dbg = wc.debugger;
  if (!dbg.isAttached()) {
    try {
      dbg.attach(DEBUGGER_PROTOCOL);
    } catch (err) {
      throw new Error(
        `could not attach the tab debugger (DevTools open on this tab?): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return dbg.sendCommand(method, params);
}

/** Trusted left-click at viewport CSS coordinates (same space as the
 *  snapshot bbox and getBoundingClientRect). */
export async function trustedClick(wc: WebContents, x: number, y: number): Promise<void> {
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (const type of ['mousePressed', 'mouseReleased'] as const) {
    await cdpSend(wc, 'Input.dispatchMouseEvent', {
      type, x: cx, y: cy, button: 'left', clickCount: 1,
    });
  }
}

/** Trusted single key press with optional modifiers (['cmd'], ['ctrl','shift']).
 *  Uses keyDown (not rawKeyDown) so DEFAULT ACTIONS fire — caret movement,
 *  form submit, shortcuts. rawKeyDown only emits the DOM event. */
export async function trustedKey(wc: WebContents, keyName: string, mods?: string[]): Promise<void> {
  const spec = resolveKey(keyName);
  if (!spec) throw new Error(`unknown key: ${keyName}`);
  const modifiers = parseModifiers(mods);
  const base = {
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.windowsVirtualKeyCode,
    nativeVirtualKeyCode: spec.windowsVirtualKeyCode,
    modifiers,
  };
  await cdpSend(wc, 'Input.dispatchKeyEvent', { ...base, type: 'keyDown' });
  await cdpSend(wc, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

/** Trusted text insertion at the focused element — the fast, IME-safe way to
 *  type long text (no per-character key events). */
export async function trustedInsertText(wc: WebContents, text: string): Promise<void> {
  await cdpSend(wc, 'Input.insertText', { text: String(text) });
}
