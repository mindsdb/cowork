// Page-side scripts for the agent bridge, executed via
// webContents.executeJavaScript. Each builder interpolates sanitized params
// into a self-contained IIFE string — the tab webContents has no preload and
// no Node, so everything the script needs must be inline.
//
// Snapshot and click/type coordinate through a stash on window (default
// __coworkBrowserEls; the manager passes a per-launch randomized name so a
// hostile page can't fake or wipe it): the snapshot script stashes
// { v, els } there — the matched element refs plus an incrementing version —
// so a later click-by-index hits the SAME element even if the DOM re-ordered,
// and a click/type carrying a stale `v` is refused.

import { classifyControl } from './browser-logic';
import type { ControlLike } from './browser-logic';

export const DEFAULT_SNAPSHOT_MAX_ELS = 150;
export const MAX_SNAPSHOT_MAX_ELS = 400;
export const DEFAULT_READ_MAX_CHARS = 20000;

/** Fallback stash key (unit tests, direct builder use). The manager injects
 *  a per-launch `__coworkEls_<8 hex>` instead. */
export const DEFAULT_STASH = '__coworkBrowserEls';

/** Upper bound on DOM nodes scanned per snapshot — a hostile page with
 *  hundreds of thousands of matching nodes must not pin the tab. */
export const SNAPSHOT_SCAN_LIMIT = 3000;

function clampInt(n: number, min: number, max: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

/** window[...] accessor for the stash key (JSON-quoted, so any key works). */
function stashRef(stash: string): string {
  return `window[${JSON.stringify(stash || DEFAULT_STASH)}]`;
}

/** Interactive-element snapshot: a, button, input, textarea, select,
 *  [role=button/link], [onclick], summary — visible only (non-zero box
 *  intersecting the viewport, not display:none / visibility:hidden).
 *  Stashes { v, els } and returns the version with the snapshot so later
 *  click/type calls can prove they're acting on THIS snapshot. */
export function domSnapshotScript(
  maxEls: number = DEFAULT_SNAPSHOT_MAX_ELS,
  stash: string = DEFAULT_STASH,
): string {
  const max = clampInt(maxEls, 1, MAX_SNAPSHOT_MAX_ELS);
  return `(() => {
  const MAX = ${max};
  const SCAN_MAX = ${SNAPSHOT_SCAN_LIMIT};
  const STASH = ${stashRef(stash)};
  const els = [];
  const refs = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  const INTERACTIVE = new Set(['a','button','input','textarea','select','summary']);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => n.matches('a,button,input,textarea,select,[role],[onclick],summary')
      ? NodeFilter.FILTER_ACCEPT
      : NodeFilter.FILTER_SKIP,
  });
  let scanned = 0;
  let el = walker.nextNode();
  while (el) {
    if (els.length >= MAX || scanned >= SCAN_MAX) break;
    scanned++;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    if (!INTERACTIVE.has(tag) && role !== 'button' && role !== 'link' && !el.hasAttribute('onclick')) continue;
    if (tag === 'input' && el.type === 'hidden') continue;
    if (!el.getClientRects || el.getClientRects().length === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const index = els.length;
    // Password fields: never serialize the value — labels only.
    const isPassword = tag === 'input' && el.type === 'password';
    const text = (el.innerText || (isPassword ? '' : el.value) || el.getAttribute('aria-label')
      || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim().slice(0, 120);
    const entry = { index, tag, role, text,
      bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    if (tag === 'a' && el.href) entry.href = el.href;
    if (tag === 'input' || tag === 'textarea' || tag === 'select') entry.inputType = el.type || 'text';
    // Buttons only when type=submit is EXPLICIT — el.type defaults to
    // 'submit' on buttons, which would mark every button consequential.
    if (tag === 'button' && (el.getAttribute('type') || '').toLowerCase() === 'submit') entry.inputType = 'submit';
    els.push(entry);
    refs.push(el);
    el = walker.nextNode();
  }
  const prev = STASH && typeof STASH.v === 'number' ? STASH.v : 0;
  const v = prev + 1;
  ${stashRef(stash)} = { v: v, els: refs };
  return { title: document.title, url: location.href, v: v, elements: els };
})()`;
}

/** Marker stamped on the text of consequential snapshot elements so the
 *  agent (and later the click gate) sees them on the line: '[!] Send'. */
export const CONSEQUENTIAL_MARK = '[!]';

/** Post-process a /snapshot result main-side (the page-side script can't
 *  import the word list): prefix the text of consequential controls with
 *  [!]. Anything that isn't the expected shape passes through untouched — a
 *  weird page result must not 500 the bridge. */
export function annotateSnapshot(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const elements = (result as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return result;
  return {
    ...(result as Record<string, unknown>),
    elements: elements.map((el) => {
      if (!el || typeof el !== 'object') return el;
      const control = el as ControlLike;
      if (typeof control.tag !== 'string') return el;
      if (classifyControl(control) !== 'consequential') return el;
      const text = typeof control.text === 'string' ? control.text : '';
      return {
        ...(el as Record<string, unknown>),
        text: text ? `${CONSEQUENTIAL_MARK} ${text}` : CONSEQUENTIAL_MARK,
      };
    }),
  };
}

/** Shared prelude for click/type: resolve the stash, refuse a version
 *  mismatch ('stale') and a missing/detached element (false). */
function stashLookup(stash: string, index: number, v?: number): string {
  const expected = v === undefined ? 'null' : String(clampInt(v, 0, Number.MAX_SAFE_INTEGER));
  return `  const stash = ${stashRef(stash)};
  const expected = ${expected};
  if (expected !== null && (!stash || stash.v !== expected)) return 'stale';
  const el = stash && stash.els ? stash.els[${index}] : null;
  if (!el || !el.isConnected) return false;`;
}

/** Click by snapshot index: scroll into view first, then a real el.click().
 *  Pass the snapshot's `v` to refuse acting on a newer/older snapshot. */
export function domClickScript(index: number, v?: number, stash: string = DEFAULT_STASH): string {
  const i = clampInt(index, 0, Number.MAX_SAFE_INTEGER);
  return `(() => {
${stashLookup(stash, i, v)}
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  el.click();
  return true;
})()`;
}

/** Type by snapshot index: focus + set value through the NATIVE input/
 *  textarea setter (React-controlled fields ignore plain el.value writes),
 *  then dispatch input/change. submit also fires Enter keydown + form submit.
 *  Pass the snapshot's `v` to refuse acting on a newer/older snapshot. */
export function domTypeScript(index: number, text: string, submit: boolean, v?: number, stash: string = DEFAULT_STASH): string {
  const i = clampInt(index, 0, Number.MAX_SAFE_INTEGER);
  const value = JSON.stringify(String(text ?? ''));
  return `(() => {
${stashLookup(stash, i, v)}
  const text = ${value};
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  el.focus();
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : (el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, text); else el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  if (${submit ? 'true' : 'false'}) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    const form = el.form || el.closest('form');
    if (form && form.requestSubmit) form.requestSubmit();
  }
  return true;
})()`;
}

/** Readability-lite: clone the body, strip non-content chrome, prefer
 *  article/main, collapse whitespace, cap characters. */
export function domReadScript(maxChars: number = DEFAULT_READ_MAX_CHARS): string {
  const max = clampInt(maxChars, 1, 1000000);
  return `(() => {
  const MAX = ${max};
  if (!document.body) return { title: document.title, url: location.href, text: '' };
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,nav,footer,aside,header,form,iframe')
    .forEach((n) => n.remove());
  const root = clone.querySelector('article') || clone.querySelector('main') || clone;
  let text = root.innerText || '';
  text = text.replace(/\\n{3,}/g, '\\n\\n').replace(/[ \\t]{2,}/g, ' ').trim();
  if (text.length > MAX) text = text.slice(0, MAX);
  return { title: document.title, url: location.href, text };
})()`;
}

/** Synthetic paste: dispatch a ClipboardEvent('paste') carrying a DataTransfer
 *  with the text. Body FIRST (document-level handlers — spreadsheet grids
 *  paste at the current selection this way, even when focus is stuck in a
 *  Name Box-style field that would swallow it), then the focused element as
 *  the fallback (plain form fields with no document handler). A handler that
 *  calls preventDefault flips dispatchEvent to false — that's "consumed".
 *  isTrusted:false — proven accepted by Google Sheets. */
export function domPasteScript(text: string): string {
  const value = JSON.stringify(String(text ?? ''));
  return `(() => {
  const text = ${value};
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  const mk = () => new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  const body = document.body || document.documentElement;
  let handled = body ? !body.dispatchEvent(mk()) : false;
  if (!handled) {
    const ae = document.activeElement;
    if (ae && ae !== body && ae.dispatchEvent) handled = !ae.dispatchEvent(mk());
  }
  return handled;
})()`;
}

/** Scroll the page: up/down by `amount` px (default ~0.8 viewport), or
 *  straight to top/bottom. */
export function domScrollScript(direction: string, amount?: number): string {
  const dir = direction === 'up' || direction === 'down' || direction === 'top' || direction === 'bottom'
    ? direction
    : 'down';
  const px = amount == null ? 0 : clampInt(amount, 0, 100000);
  return `(() => {
  const direction = ${JSON.stringify(dir)};
  const amount = ${px} || Math.max(200, Math.floor(window.innerHeight * 0.8));
  if (direction === 'up') window.scrollBy(0, -amount);
  else if (direction === 'down') window.scrollBy(0, amount);
  else if (direction === 'top') window.scrollTo(0, 0);
  else window.scrollTo(0, (document.body && document.body.scrollHeight) || document.documentElement.scrollHeight || 0);
  return true;
})()`;
}
