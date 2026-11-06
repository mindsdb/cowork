/* `pageWorld` runs in the page, so it is typed against the DOM. This brings the
   DOM's types into the main process's type check; it changes nothing at run
   time. */
/// <reference lib="dom" />
/*
 * The in-app browser's page reads, written for this host.
 *
 * `pageWorld` runs inside the page, in an isolated world (one fixed world id,
 * PAGE_WORLD_ID), never in the page's own world. An isolated world shares the
 * DOM with the page but has its own JavaScript globals, so the element ids live
 * in that world's Map and WeakMap and nothing is written to the DOM or to the
 * page's globals: a page can't see that it is being read. Chromium gives each
 * document a fresh isolated world, so element numbers start over with each
 * document.
 *
 * The function is sent to the page as its own source text, so it must not use
 * anything from this module: every helper lives inside it. Tests call it
 * directly on a DOM, and also run its source text, which proves it is
 * self-contained.
 *
 * Secret fields (password, current-password, new-password, one-time-code and
 * cc-* autocomplete, and any field once seen as a password) never return their
 * value; they carry `value_hidden`. Challenge frames are only reported when the
 * person can see them: the page lists its frame elements and whether each one
 * shows, and main joins them with the frame tree's URLs (`challengesFrom`).
 */

import type { Challenge, PageElement, PageScroll, PageSnapshot } from '../shared/browser-contract';

/** The isolated world every read runs in: not 0 (the page's) and not 999 (Electron's preload world). */
export const PAGE_WORLD_ID = 1031;

/** A read that takes longer than this answers 409 page_busy. */
export const PAGE_READ_TIMEOUT_MS = 10_000;

export interface PageWorldState {
  ids: Map<number, Element>;
  byElement: WeakMap<Element, number>;
  next: number;
  secret: WeakSet<Element>;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementBox extends Box {
  id: number;
}

export interface DomFrame {
  url: string;
  visible: boolean;
}

export type PageWorldRequest =
  | { kind: 'snapshot'; maxText: number; maxElements: number }
  | { kind: 'locate'; id: number; reveal: boolean }
  | { kind: 'focusedSecret' }
  | { kind: 'viewport' }
  /* Selects a field's text so typing replaces it; ok is false when there was none. */
  | { kind: 'selectContents'; id: number }
  | { kind: 'select'; id: number; values: string[] };

export interface RawSnapshot {
  url: string;
  title: string;
  scroll: PageScroll;
  elements: PageElement[];
  text: string;
  truncated: boolean;
  /** Every frame element in the page's DOM (open shadow roots included), and
      whether the person can see it: a non-empty box in the viewport, not hidden. */
  frames: DomFrame[];
  /** Boxes of the numbered elements in the viewport, in CSS pixels, for screenshot labels. */
  boxes: ElementBox[];
  viewport: { width: number; height: number };
}

export type LocateResult =
  | { found: false }
  | {
    found: true;
    box: Box;
    shown: boolean;
    inViewport: boolean;
    secret: boolean;
    disabled: boolean;
    tag: string;
    viewport: { width: number; height: number };
  };

export type SelectResult =
  | { ok: true; chosen: string[] }
  | { ok: false; reason: 'not_found' | 'not_select' | 'no_option' | 'single'; options?: string[] };

/**
 * One read or one small DOM step, run in the isolated world. `world` is the
 * isolated world's own state object; `request` says what to do.
 */
export function pageWorld(doc: Document, world: PageWorldState, request: PageWorldRequest): unknown {
  const win = doc.defaultView as Window;
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'option', 'combobox', 'listbox', 'textbox', 'searchbox', 'slider',
    'spinbutton', 'treeitem',
  ]);
  const SECRET_AUTOCOMPLETE = /(^|\s)(current-password|new-password|one-time-code|cc-[a-z-]+)(\s|$)/;
  const viewport = { width: Math.round(win.innerWidth), height: Math.round(win.innerHeight) };
  const clean = (value: string | null | undefined, max: number): string =>
    (value || '').replace(/\s+/g, ' ').trim().slice(0, max);

  const tagOf = (el: Element): string => el.tagName.toLowerCase();
  const inputType = (el: Element): string => (el.getAttribute('type') || 'text').toLowerCase();
  const editable = (el: Element): boolean => {
    const value = el.getAttribute('contenteditable');
    return value === '' || value === 'true' || value === 'plaintext-only';
  };
  const boxOf = (el: Element): Box => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  };
  const shown = (el: Element, box: Box): boolean => {
    if (box.width <= 0 || box.height <= 0) return false;
    const style = win.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || '1') > 0;
  };
  const inView = (box: Box): boolean =>
    box.x < viewport.width && box.y < viewport.height && box.x + box.width > 0 && box.y + box.height > 0;
  const isSecret = (el: Element): boolean => {
    if (world.secret.has(el)) return true;
    const auto = (el.getAttribute('autocomplete') || '').toLowerCase();
    if ((tagOf(el) === 'input' && inputType(el) === 'password') || SECRET_AUTOCOMPLETE.test(auto)) {
      world.secret.add(el);
      return true;
    }
    return false;
  };
  const isDisabled = (el: Element): boolean =>
    (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';

  const roleOf = (el: Element): string => {
    const explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0].toLowerCase();
    if (explicit && INTERACTIVE_ROLES.has(explicit)) return explicit;
    const tag = tagOf(el);
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : '';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'iframe') return 'clickable';
    if (tag === 'input') {
      const type = inputType(el);
      if (type === 'hidden') return '';
      if (type === 'checkbox' || type === 'radio') return type;
      if (['button', 'submit', 'reset', 'image', 'file'].includes(type)) return 'button';
      if (type === 'range') return 'slider';
      if (type === 'search') return 'searchbox';
      if (type === 'number') return 'spinbutton';
      return 'textbox';
    }
    if (editable(el)) return 'textbox';
    const tabindex = el.getAttribute('tabindex');
    if (el.hasAttribute('onclick') || (tabindex !== null && tabindex !== '-1')) return 'clickable';
    return '';
  };

  const textOf = (el: Element): string => (el as HTMLElement).innerText ?? el.textContent ?? '';

  /* A label's own words: a label that wraps its control would otherwise name a
     list box after every option in it. */
  const labelText = (label: Element, control: Element): string => {
    let text = '';
    const walk = (node: Node) => {
      if (node === control) return;
      if (node.nodeType === 3) text += node.textContent || '';
      else node.childNodes.forEach(walk);
    };
    walk(label);
    return text;
  };

  const nameOf = (el: Element, role: string): string => {
    const aria = clean(el.getAttribute('aria-label'), 120);
    if (aria) return aria;
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = clean(labelledBy.split(/\s+/).map((id) => doc.getElementById(id)?.textContent || '').join(' '), 120);
      if (text) return text;
    }
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) {
      const text = clean(Array.from(labels).map((label) => labelText(label, el)).join(' '), 120);
      if (text) return text;
    }
    const tag = tagOf(el);
    if (tag === 'iframe') return clean(el.getAttribute('title') || el.getAttribute('name') || 'frame', 120);
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(inputType(el))) {
      return clean((el as HTMLInputElement).value || inputType(el), 120);
    }
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'listbox' || role === 'spinbutton') {
      const hint = clean(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name'), 120);
      if (hint) return hint;
    }
    const text = clean(textOf(el), 120);
    if (text) return text;
    const img = el.querySelector('img[alt]');
    return clean(img?.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder'), 120);
  };

  const describe = (el: Element, id: number, role: string, offscreen: boolean): Record<string, unknown> => {
    const entry: Record<string, unknown> = { id, role, name: nameOf(el, role) };
    const tag = tagOf(el);
    if (isSecret(el)) {
      entry.value_hidden = true;
      if (tag === 'input' && inputType(el) === 'password') entry.type = 'password';
    } else if (tag === 'select') {
      const select = el as HTMLSelectElement;
      entry.value = clean(Array.from(select.selectedOptions).map((o) => o.label || o.text).join(', '), 500);
      entry.options = Array.from(select.options).slice(0, 50).map((o) => clean(o.label || o.text, 120));
    } else if (tag === 'textarea' || (tag === 'input' && role !== 'button' && role !== 'checkbox' && role !== 'radio')) {
      const value = (el as HTMLInputElement).value;
      if (value) entry.value = value.slice(0, 500);
    } else if (editable(el)) {
      const value = clean(el.textContent, 500);
      if (value) entry.value = value;
    }
    if (role === 'checkbox' || role === 'radio' || role === 'switch') {
      const aria = el.getAttribute('aria-checked');
      entry.checked = aria !== null ? aria === 'true' : (el as HTMLInputElement).checked === true;
    }
    if (isDisabled(el)) entry.disabled = true;
    if (offscreen) entry.offscreen = true;
    return entry;
  };

  const elementsIn = (root: Node): Element[] => {
    const found: Element[] = [];
    const visit = (from: Node) => {
      const walker = doc.createTreeWalker(from, 1);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node as Element;
        found.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(root);
    return found;
  };

  const snapshot = (maxText: number, maxElements: number) => {
    for (const [id, el] of world.ids) {
      if (!el.isConnected) {
        world.ids.delete(id);
        world.byElement.delete(el);
      }
    }
    const elements: Record<string, unknown>[] = [];
    const boxes: ElementBox[] = [];
    const frames: DomFrame[] = [];
    const root = doc.body || doc.documentElement;
    for (const el of root ? elementsIn(root) : []) {
      const role = roleOf(el);
      if (!role) continue;
      const box = boxOf(el);
      const isShown = shown(el, box);
      const visible = isShown && inView(box);
      if (tagOf(el) === 'iframe') {
        const src = (el as HTMLIFrameElement).src;
        if (src) frames.push({ url: src, visible });
      }
      if (!isShown) continue;
      if (elements.length >= maxElements) continue;
      let id = world.byElement.get(el);
      if (id === undefined) {
        id = world.next;
        world.next += 1;
        world.byElement.set(el, id);
        world.ids.set(id, el);
      }
      elements.push(describe(el, id, role, !visible));
      if (visible) {
        boxes.push({
          id,
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        });
      }
    }
    const fullText = (doc.body ? textOf(doc.body) : '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    const scroller = doc.scrollingElement || doc.documentElement;
    return {
      url: String(doc.location?.href || ''),
      title: clean(doc.title, 300),
      scroll: {
        y: Math.round(win.scrollY || 0),
        height: Math.round(scroller ? scroller.scrollHeight : 0),
        viewport: viewport.height,
      },
      elements,
      text: fullText.slice(0, maxText),
      truncated: fullText.length > maxText,
      frames,
      boxes,
      viewport,
    };
  };

  const deepActive = (): Element | null => {
    let active = doc.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
    return active;
  };

  switch (request.kind) {
    case 'snapshot':
      return snapshot(request.maxText, request.maxElements);
    case 'locate': {
      const el = world.ids.get(request.id);
      if (!el || !el.isConnected) return { found: false };
      if (request.reveal) el.scrollIntoView({ block: 'center', inline: 'center' });
      const box = boxOf(el);
      return {
        found: true,
        box,
        shown: shown(el, box),
        inViewport: box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
        secret: isSecret(el),
        disabled: isDisabled(el),
        tag: tagOf(el),
        viewport,
      };
    }
    case 'viewport':
      return viewport;
    case 'focusedSecret': {
      const active = deepActive();
      return { secret: !!active && active !== doc.body && isSecret(active) };
    }
    case 'selectContents': {
      const el = world.ids.get(request.id);
      if (!el || !el.isConnected) return { ok: false };
      const tag = tagOf(el);
      if (tag === 'input' || tag === 'textarea') {
        if (!(el as HTMLInputElement).value) return { ok: false };
        (el as HTMLInputElement).select();
        return { ok: true };
      }
      if (!el.textContent) return { ok: false };
      const selection = win.getSelection();
      if (!selection) return { ok: false };
      const range = doc.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      return { ok: true };
    }
    case 'select': {
      const el = world.ids.get(request.id);
      if (!el || !el.isConnected) return { ok: false, reason: 'not_found' };
      if (tagOf(el) !== 'select') return { ok: false, reason: 'not_select' };
      const select = el as HTMLSelectElement;
      const options = Array.from(select.options);
      if (!select.multiple && request.values.length > 1) return { ok: false, reason: 'single' };
      const matches = request.values.map((wanted) =>
        options.find((o) => o.value === wanted || clean(o.label || o.text, 500) === wanted)
        || options.find((o) => clean(o.label || o.text, 500).toLowerCase() === wanted.toLowerCase()));
      if (matches.some((m) => !m)) {
        return { ok: false, reason: 'no_option', options: options.slice(0, 50).map((o) => clean(o.label || o.text, 120)) };
      }
      for (const option of options) option.selected = matches.includes(option);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, chosen: matches.map((m) => clean((m as HTMLOptionElement).label || (m as HTMLOptionElement).text, 120)) };
    }
  }
}

/** The page answer anton reads: the read without main's own fields, with the checks the person can see. */
export function pageAnswer(raw: RawSnapshot, challenges: Challenge[]): PageSnapshot {
  return {
    url: raw.url,
    title: raw.title,
    scroll: raw.scroll,
    elements: raw.elements,
    text: raw.text,
    truncated: raw.truncated,
    challenges,
  };
}

/* The isolated world's own global holds the state between reads. That global
   belongs to the isolated world, not to the page, so the page never sees it. */
const WORLD_STATE_KEY = '__coworkBrowserWorld';

/** The source text that runs `request` in the isolated world. */
export function pageWorldSource(request: PageWorldRequest): string {
  const state = `globalThis[${JSON.stringify(WORLD_STATE_KEY)}] ??= { ids: new Map(), byElement: new WeakMap(), next: 1, secret: new WeakSet() }`;
  return `(${pageWorld.toString()})(document, ${state}, ${JSON.stringify(request)})`;
}

// ---- Challenges ------------------------------------------------------------

/** The check a frame address belongs to, or null. A reCAPTCHA anchor marked
    invisible never shows the person anything, so it is not a check here. */
export function challengeKind(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname;
  const under = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (host === 'challenges.cloudflare.com') return 'cloudflare';
  if ((host === 'www.google.com' || host === 'recaptcha.google.com' || under('recaptcha.net')) && url.pathname.startsWith('/recaptcha/')) {
    return url.searchParams.get('size') === 'invisible' ? null : 'recaptcha';
  }
  if (under('hcaptcha.com')) return 'hcaptcha';
  if (under('arkoselabs.com') || under('funcaptcha.com')) return 'arkose';
  if (host === 'geo.captcha-delivery.com') return 'datadome';
  return null;
}

/** A frame in the page's frame tree, with its own viewport size when it was asked. */
export interface FrameInfo {
  url: string;
  /** The frame's own innerWidth and innerHeight, or null when it wasn't asked or didn't answer. */
  size: { width: number; height: number } | null;
}

/* A check frame smaller than this can't hold a check a person solves. */
const MIN_CHECK_PX = 30;

function hostOf(address: string): string | null {
  try {
    return new URL(address).hostname;
  } catch {
    return null;
  }
}

/**
 * The checks a person can see: frames in the frame tree whose address is a
 * check's, and that the page shows. When the page's DOM has frame elements
 * from that host, the check counts only if one of them is visible. When it has
 * none (a closed shadow root holds the frame, or another frame does), the
 * frame's own viewport decides: at least MIN_CHECK_PX each way. One entry per
 * host.
 */
export function challengesFrom(frames: FrameInfo[], domFrames: DomFrame[]): Challenge[] {
  const domByHost = new Map<string, boolean>();
  for (const frame of domFrames) {
    const host = hostOf(frame.url);
    if (host) domByHost.set(host, (domByHost.get(host) ?? false) || frame.visible);
  }
  const found = new Map<string, Challenge>();
  for (const frame of frames) {
    const kind = challengeKind(frame.url);
    const host = hostOf(frame.url);
    if (!kind || !host || found.has(host)) continue;
    const inDom = domByHost.get(host);
    const seen = inDom !== undefined
      ? inDom
      : frame.size !== null && frame.size.width >= MIN_CHECK_PX && frame.size.height >= MIN_CHECK_PX;
    if (seen) found.set(host, { host, kind });
  }
  return [...found.values()];
}
