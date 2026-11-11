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
 * cc-* autocomplete, and any field once seen as one of those) never return
 * their value; they carry `value_hidden`, and a type, a select or an editing
 * key into one is refused. The `watch` request marks every secret field and
 * starts a MutationObserver, so a "show password" toggle after it still
 * counts. The tab sends it for each new document and when the person takes
 * the browser, but Electron runs no isolated-world script while the page is
 * still loading, so the watch starts only once the page stops loading: a
 * password the person shows before then, with no read in between, reads as
 * an ordinary field. It watches the document and the open shadow roots it
 * finds, and a toggle in a closed shadow root counts only once a read has
 * seen the field as secret. Challenge frames are reported when the person can
 * see them: the page lists its frame elements and whether each one shows, and
 * main joins them with the frame tree's URLs (`challengesFrom`), which counts
 * a check frame with no element in the DOM by its presence.
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
  /** The secret-field watch, once `watch` has started it on this document. */
  observer: MutationObserver | null;
  /** The document and the open shadow roots the watch observes. */
  watched: WeakSet<Node>;
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
  /* Where the focus is while a type step types into element `id`. */
  | { kind: 'typingFocus'; id: number }
  | { kind: 'viewport' }
  /* Focuses a text field for typing; with `select`, selects its text so typing replaces it. */
  | { kind: 'focusField'; id: number; select: boolean }
  /* Focuses an element for a key press; `editing` when the key edits text. */
  | { kind: 'focus'; id: number; editing: boolean }
  | { kind: 'select'; id: number; values: string[] }
  | { kind: 'watch' };

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
  | { ok: false; reason: 'not_found' | 'secret' | 'not_select' | 'no_option' | 'single'; options?: string[] };

/** A text field focused for typing. `selected`: its text is selected, so a
    Backspace clears it. A secret field is left alone, and `unfocusable` means
    the focus didn't land in it (a disabled or hidden field). */
export type FocusFieldResult =
  | { ok: true; selected: boolean }
  | { ok: false; reason: 'not_found' | 'secret' | 'not_text' | 'unfocusable' };

/** An element focused for a key press. A secret one is left alone when the key edits text. */
export type FocusResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'secret' | 'unfocusable' };

/** The focus before each key of a type step: whether it is on a secret field,
    and whether it is still in the field the step types into. */
export interface TypingFocus {
  secret: boolean;
  inField: boolean;
}

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
  /* An ordinary field's value is read up to this many characters. */
  const MAX_VALUE_CHARS = 200;
  const NOT_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);
  const viewport = { width: Math.round(win.innerWidth), height: Math.round(win.innerHeight) };
  const clean = (value: string | null | undefined, max: number): string =>
    (value || '').replace(/\s+/g, ' ').trim().slice(0, max);

  const tagOf = (el: Element): string => el.tagName.toLowerCase();
  const inputType = (el: Element): string => (el.getAttribute('type') || 'text').toLowerCase();
  const editable = (el: Element): boolean => {
    const value = el.getAttribute('contenteditable');
    return value === '' || value === 'true' || value === 'plaintext-only';
  };
  /* Editable as part of an editor, its own attribute or not. */
  const contentEditable = (el: Element | null): boolean => (el as HTMLElement | null)?.isContentEditable === true;
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
  /* An input or textarea a person types text into, or an editor. */
  const isTextField = (el: Element): boolean => tagOf(el) === 'textarea'
    || (tagOf(el) === 'input' && !NOT_TEXT_INPUTS.has(inputType(el)))
    || editable(el) || contentEditable(el);
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
      entry.value = clean(Array.from(select.selectedOptions).map((o) => o.label || o.text).join(', '), MAX_VALUE_CHARS);
      entry.options = Array.from(select.options).slice(0, 50).map((o) => clean(o.label || o.text, 120));
    } else if (tag === 'textarea' || (tag === 'input' && role !== 'button' && role !== 'checkbox' && role !== 'radio')) {
      const value = (el as HTMLInputElement).value;
      if (value) entry.value = value.slice(0, MAX_VALUE_CHARS);
    } else if (editable(el)) {
      const value = clean(el.textContent, MAX_VALUE_CHARS);
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

  /* A node's parent, or a shadow root's host. */
  const parentAcross = (node: Node): Node | null => node.parentNode ?? (node.nodeType === 11 ? (node as ShadowRoot).host ?? null : null);

  /* Whether the focus is on `el` or inside it, across shadow roots, or on the
     editing host `el` is part of. */
  const focusIn = (el: Element): boolean => {
    const active = deepActive();
    for (let at: Node | null = active; at; at = parentAcross(at)) {
      if (at === el) return true;
    }
    return contentEditable(el) && contentEditable(active) && !!active?.contains(el);
  };

  const focusOnSecret = (): boolean => {
    const active = deepActive();
    return !!active && active !== doc.body && isSecret(active);
  };

  /* Selects a field's text so typing replaces it; false when it held none. */
  const selectContents = (el: Element): boolean => {
    const tag = tagOf(el);
    if (tag === 'input' || tag === 'textarea') {
      if (!(el as HTMLInputElement).value) return false;
      (el as HTMLInputElement).select();
      return true;
    }
    const selection = win.getSelection();
    if (!el.textContent || !selection) return false;
    const range = doc.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };

  /* The secret-field watch. It observes the document and each open shadow
     root it finds, once each. */
  const watchRoot = (root: Node): void => {
    if (!world.observer || world.watched.has(root)) return;
    world.watched.add(root);
    world.observer.observe(root, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['type', 'autocomplete'], attributeOldValue: true,
    });
  };
  /* Marks every secret field in `node` and below it, open shadow roots
     included (isSecret remembers each), and watches each open shadow root. */
  const markSecrets = (node: Node): void => {
    const top = node.nodeType === 1 ? [node as Element] : [];
    const own = top[0]?.shadowRoot;
    for (const el of [...top, ...elementsIn(node), ...(own ? elementsIn(own) : [])]) {
      isSecret(el);
      if (el.shadowRoot) watchRoot(el.shadowRoot);
    }
  };
  /* A field that was a password, or had a secret autocomplete, stays secret
     after it changes; an added one is marked as it arrives. */
  const onMutations = (records: MutationRecord[]): void => {
    for (const record of records) {
      if (record.type === 'childList') {
        record.addedNodes.forEach((node) => {
          if (node.nodeType === 1) markSecrets(node);
        });
        continue;
      }
      const old = (record.oldValue || '').toLowerCase();
      const was = record.attributeName === 'type' ? old === 'password' : SECRET_AUTOCOMPLETE.test(old);
      if (was) world.secret.add(record.target as Element);
      else isSecret(record.target as Element);
    }
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
    case 'focusedSecret':
      return { secret: focusOnSecret() };
    case 'typingFocus': {
      const el = world.ids.get(request.id);
      return { secret: focusOnSecret(), inField: !!el && el.isConnected && focusIn(el) };
    }
    case 'focusField': {
      const el = world.ids.get(request.id);
      if (!el || !el.isConnected) return { ok: false, reason: 'not_found' };
      if (isSecret(el)) return { ok: false, reason: 'secret' };
      if (!isTextField(el)) return { ok: false, reason: 'not_text' };
      (el as HTMLElement).focus();
      if (!focusIn(el)) return { ok: false, reason: 'unfocusable' };
      return { ok: true, selected: request.select && selectContents(el) };
    }
    case 'focus': {
      const el = world.ids.get(request.id);
      if (!el || !el.isConnected) return { ok: false, reason: 'not_found' };
      if (request.editing && isSecret(el)) return { ok: false, reason: 'secret' };
      if (!focusIn(el)) (el as HTMLElement).focus();
      return focusIn(el) ? { ok: true } : { ok: false, reason: 'unfocusable' };
    }
    case 'select': {
      const el = world.ids.get(request.id);
      if (!el || !el.isConnected) return { ok: false, reason: 'not_found' };
      if (isSecret(el)) return { ok: false, reason: 'secret' };
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
    case 'watch':
      world.observer ??= new MutationObserver(onMutations);
      watchRoot(doc);
      markSecrets(doc);
      return { ok: true };
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
  const state = `globalThis[${JSON.stringify(WORLD_STATE_KEY)}] ??= { ids: new Map(), byElement: new WeakMap(), next: 1, secret: new WeakSet(), observer: null, watched: new WeakSet() }`;
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

function hostOf(address: string): string | null {
  try {
    return new URL(address).hostname;
  } catch {
    return null;
  }
}

/**
 * The checks a person can see: frames in the frame tree (`frameUrls`, the
 * main frame left out) whose address is a check's, and that the page shows.
 * When the page's DOM has frame elements from that host, the check counts
 * only if one of them is visible. When it has none (a closed shadow root holds
 * the frame, or another frame does), the frame counts by being there: asking
 * its size would run script in the frame's own world, where the check's
 * script could see it. One entry per host.
 */
export function challengesFrom(frameUrls: string[], domFrames: DomFrame[]): Challenge[] {
  const domByHost = new Map<string, boolean>();
  for (const frame of domFrames) {
    const host = hostOf(frame.url);
    if (host) domByHost.set(host, (domByHost.get(host) ?? false) || frame.visible);
  }
  const found = new Map<string, Challenge>();
  for (const url of frameUrls) {
    const kind = challengeKind(url);
    const host = hostOf(url);
    if (!kind || !host || found.has(host)) continue;
    if (domByHost.get(host) ?? true) found.set(host, { host, kind });
  }
  return [...found.values()];
}
