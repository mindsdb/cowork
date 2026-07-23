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
  // First non-empty label, each candidate trimmed BEFORE falling through —
  // whitespace-only innerText must not shadow the aria-label.
  const firstLabel = (...cands) => {
    for (const c of cands) { const t = (c || '').trim(); if (t) return t; }
    return '';
  };
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
    const text = firstLabel(el.innerText, (isPassword ? '' : el.value), el.getAttribute('aria-label'),
      el.getAttribute('placeholder'), el.getAttribute('title')).slice(0, 120);
    const entry = { index, tag, role, text,
      bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    if (tag === 'a' && el.href) entry.href = el.href;
    // aria-label rides along separately so the gate sees BOTH signals.
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) entry.ariaLabel = aria.slice(0, 120);
    if (tag === 'input' || tag === 'textarea' || tag === 'select') entry.inputType = el.type || 'text';
    // Buttons: explicit type=submit, or a TYPELESS button inside a form (HTML
    // default-button rule — el.type defaults to 'submit' and Enter submits).
    if (tag === 'button') {
      const bt = (el.getAttribute('type') || '').toLowerCase();
      if (bt === 'submit' || (!bt && el.form)) entry.inputType = 'submit';
    }
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
 *  import the word list): FIRST strip any leading [!] the page put there
 *  itself (forgery), then re-derive — prefix the text of consequential
 *  controls with [!] and stamp a machine-readable `consequential: true`.
 *  Idempotent, and a page can't forge the marker on a safe element. The
 *  agent reads the marker, the approval gate reads the field. Anything that
 *  isn't the expected shape passes through untouched — a weird page result
 *  must not 500 the bridge. */
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
      // Strip forged/previous markers before re-deriving from scratch.
      const text = (typeof control.text === 'string' ? control.text : '').replace(/^(\[!\]\s*)+/, '');
      const base = { ...(el as Record<string, unknown>), text };
      if (classifyControl({ ...control, text }) !== 'consequential') return base;
      return {
        ...base,
        consequential: true,
        text: text ? `${CONSEQUENTIAL_MARK} ${text}` : CONSEQUENTIAL_MARK,
      };
    }),
  };
}

/** Shared /inspect-* result shaping: garbage page results → {found:false};
 *  otherwise the raw control info + `found: true` + a machine-readable
 *  `consequential` flag, classified main-side via classifyControl (the page
 *  scripts can't import the word list). `submitCandidates` from the page
 *  (compose container / form association) are ALL classified and the worst
 *  folded in: the first consequential candidate becomes `submit` (attach/
 *  emoji buttons sit before Send in Slack/Discord composers), and
 *  `implicitSubmit: true` (single-text-input forms) forces consequential. */
export function inspectResult(info: unknown): unknown {
  if (!info || typeof info !== 'object') return { found: false };
  const control = info as ControlLike;
  if (typeof control.tag !== 'string') return { found: false };
  const out: Record<string, unknown> = { ...(info as Record<string, unknown>), found: true };
  delete out.submitCandidates;
  let consequential = classifyControl(control) === 'consequential';
  const raw = (info as { submitCandidates?: unknown }).submitCandidates;
  if (Array.isArray(raw)) {
    const annotated = raw
      .filter((c): c is Record<string, unknown> =>
        !!c && typeof c === 'object' && typeof (c as ControlLike).tag === 'string')
      .map((c) => ({ ...c, consequential: classifyControl(c as unknown as ControlLike) === 'consequential' }));
    const chosen = annotated.find((a) => a.consequential === true) ?? annotated[0];
    if (chosen) {
      out.submit = chosen;
      if (chosen.consequential === true) consequential = true;
    }
  }
  if ((info as { implicitSubmit?: unknown }).implicitSubmit === true) consequential = true;
  out.consequential = consequential;
  return out;
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

// ---------------------------------------------------------------------------
// Inspect scripts (/inspect-point, /inspect-active): locate ONE control and
// serialize it raw — classification happens main-side via inspectResult
// (the page scripts can't import the word list).
// ---------------------------------------------------------------------------

/** The snapshot walker's interactive definition as a closest() selector. */
const INTERACTIVE_SELECTOR = 'a,button,input,textarea,select,summary,[role=button],[role=link],[onclick]';

/** Page-side control serializer, interpolated into both inspect scripts —
 *  identical shape to the snapshot walker's entries minus the stash index. */
const INFO_OF = `function firstLabel(...cands) {
  for (const c of cands) { const t = (c || '').trim(); if (t) return t; }
  return '';
}
function infoOf(control) {
  const tag = control.tagName.toLowerCase();
  const role = control.getAttribute('role');
  // Password fields: never serialize the value — labels only.
  const isPassword = tag === 'input' && control.type === 'password';
  // Trim each candidate BEFORE falling through — whitespace-only innerText
  // must not shadow the aria-label.
  const text = firstLabel(control.innerText, (isPassword ? '' : control.value), control.getAttribute('aria-label'),
    control.getAttribute('placeholder'), control.getAttribute('title')).slice(0, 120);
  const r = control.getBoundingClientRect();
  const info = { tag, role, text,
    bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  if (tag === 'a' && control.href) info.href = control.href;
  // aria-label rides along separately so the gate sees BOTH signals.
  const aria = (control.getAttribute('aria-label') || '').trim();
  if (aria) info.ariaLabel = aria.slice(0, 120);
  if (tag === 'input' || tag === 'textarea' || tag === 'select') info.inputType = control.type || 'text';
  // Buttons: explicit type=submit, or a TYPELESS button inside a form (HTML
  // default-button rule — el.type defaults to 'submit' and Enter submits).
  if (tag === 'button') {
    const bt = (control.getAttribute('type') || '').toLowerCase();
    if (bt === 'submit' || (!bt && control.form)) info.inputType = 'submit';
  }
  return info;
}`;

/** Submit-capable controls (the HTML default-button set: explicit submits,
 *  image inputs, and typeless buttons — a missing button type defaults to
 *  submit). Interpolated into the inspect-active script. */
const SUBMIT_SELECTOR = 'input[type="submit"],input[type="image"],button:not([type]),button[type="submit"]';

/** The control at viewport point (x, y): elementFromPoint, then up to the
 *  nearest interactive control. Raw info, or false when nothing interactive
 *  is there — the bridge shapes the response via inspectResult. */
export function domInspectPointScript(x: number, y: number): string {
  const px = clampInt(x, 0, 100000);
  const py = clampInt(y, 0, 100000);
  return `(() => {
  ${INFO_OF}
  const el = document.elementFromPoint(${px}, ${py});
  if (!el || !el.closest) return false;
  const control = el.closest(${JSON.stringify(INTERACTIVE_SELECTOR)});
  if (!control) return false;
  if (control.tagName.toLowerCase() === 'input' && control.type === 'hidden') return false;
  return infoOf(control);
})()`;
}

/** The focused control (document.activeElement), or the enclosing
 *  contenteditable compose area when focus is inside one. Text-ish fields in
 *  a form also carry the form's submit association (implicit submission —
 *  Enter submits from them). Raw info, or false when nothing useful is
 *  focused — the bridge shapes the response via inspectResult. */
export function domInspectActiveScript(): string {
  return `(() => {
  ${INFO_OF}
  const TEXTISH = new Set(['', 'text', 'search', 'url', 'tel', 'email', 'password', 'number']);
  const isTextish = (el) => {
    const t = el.tagName.toLowerCase();
    return t === 'textarea' || (t === 'input' && TEXTISH.has((el.getAttribute('type') || '').toLowerCase()));
  };
  const isTextInput = (el) => el.tagName.toLowerCase() === 'input' && isTextish(el);
  const ae = document.activeElement;
  if (!ae || ae === document.body || ae === document.documentElement) return false;
  const control = ae.closest ? ae.closest(${JSON.stringify(INTERACTIVE_SELECTOR)}) : null;
  if (control) {
    const info = infoOf(control);
    // Form association for text-ish fields: the form's default button, or
    // the single-text-input implicit-submission rule (Enter submits even
    // without a submit control).
    const form = control.form;
    if (form && isTextish(control)) {
      const defaults = Array.from(form.querySelectorAll(${JSON.stringify(SUBMIT_SELECTOR)}));
      info.submitCandidates = defaults.slice(0, 5).map(infoOf);
      if (defaults.length === 0 && control.tagName.toLowerCase() === 'input'
        && Array.from(form.querySelectorAll('input')).filter(isTextInput).length === 1) {
        info.implicitSubmit = true;
      }
    }
    return info;
  }
  if (!ae.isContentEditable) return false;
  // Compose area: report the enclosing contenteditable root, labelled by
  // aria/placeholder/title only — its innerText is the user's draft, not a
  // control label (and would false-positive the consequential word list).
  const root = (ae.closest && ae.closest('[contenteditable]:not([contenteditable="false"])')) || ae;
  const role = root.getAttribute('role');
  const text = firstLabel(root.getAttribute('aria-label'), root.getAttribute('placeholder'),
    root.getAttribute('title')).slice(0, 120);
  // Associated submit controls: the same form's submits, else ALL button-ish
  // controls at the first enclosing level that has any (walk up <= 3) — the
  // bridge classifies every candidate and folds in the worst (attach/emoji
  // buttons sit before Send in Slack/Discord composers).
  let candidates = [];
  const form = root.closest ? root.closest('form') : null;
  if (form) candidates = Array.from(form.querySelectorAll(${JSON.stringify(SUBMIT_SELECTOR)}));
  if (candidates.length === 0) {
    let host = root.parentElement;
    for (let i = 0; host && i < 3 && candidates.length === 0; i++, host = host.parentElement) {
      candidates = Array.from(host.querySelectorAll('button,[role="button"],input[type="submit"]'));
    }
  }
  return { tag: 'contenteditable', role, text, submitCandidates: candidates.slice(0, 5).map(infoOf) };
})()`;
}
