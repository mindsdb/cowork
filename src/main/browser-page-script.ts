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
 * seen the field as secret. A secret editor's text (a contenteditable field
 * with a secret autocomplete) stays out of the page text and out of every
 * name. Challenge frames are reported when the person can see them: the page
 * lists its frame elements and whether each one shows, and main joins them
 * with the frame tree's URLs (`challengesFrom`), which counts a check frame
 * with no element in the DOM by its presence. A frame owner (an iframe, a
 * frame, an object or an embed) is never an element, and each click by number
 * presses a point whose hit test reaches its element (`hitTest`) without
 * landing in a frame owner or in a custom element sealed from this world, so
 * a click by number never lands inside a frame.
 *
 * Each agent step runs a change watch (`changeStart`, `changeMark`,
 * `changeStop`) under the step's token: a MutationObserver over the document
 * and its open shadow roots, and scroll, input, change and toggle listeners.
 * It counts records and events and never reads text, a value or an
 * attribute's content. A style change counts, but doesn't keep the page from
 * going quiet, so an animation can't hold a step. Focus doesn't count.
 *
 * A page read lists every child frame a click can land in, a transparent
 * one included, with its content box, and reads the ones it may: a shown,
 * same-origin frame, big enough, within the read cap, on no payment, sign-in
 * or consent address, and holding no secret, card or sign-in field. A read frame's elements have no id and no
 * field value. A frame from another site can't be read from here: running
 * script in its own world would let its page see it. `secretBoxes` finds what
 * every screenshot blacks out.
 */

import {
  type Challenge,
  ELEMENTS_PER_FRAME,
  type FrameBox,
  FRAME_MIN_READ_PX,
  FRAMES_READ,
  PAYMENT_FRAME_HOSTS,
  type PageElement,
  type PageFrame,
  type PageFrameElement,
  type PageScroll,
  type PageSnapshot,
  SIGN_IN_FRAME_HOSTS,
  TEXT_PER_FRAME,
} from '../shared/browser-contract';
import { screenshotScale } from './browser-screenshot';

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
  /** The running step's change watch. */
  change: ChangeWatch | null;
}

/** What a step's change watch counted since the step began. */
export interface ChangeWatch {
  token: number;
  changes: number;
  /** performance.now() of the last change to content: nodes, text, or an
      attribute other than style. */
  lastContentAt: number;
  observer: MutationObserver;
  /** The document and the open shadow roots it observes. */
  roots: Node[];
  observed: WeakSet<Node>;
  listener: () => void;
}

/** A step's change watch as read while the step settles. `busy`: the page
    marks something aria-busy. `opaque`: a change could happen where the
    watch can't see it (a frame, canvas or media element in view, or a custom
    element with no open shadow root under the step's pointer or focus). */
export interface ChangeMark {
  changes: number;
  sinceLastMs: number;
  busy: boolean;
  opaque: boolean;
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

/** A frame owner in the page's DOM: the address it names, whether the person
    can see it, and whether it holds one of the document's child frames
    (`framed`): an HTML iframe or frame always does, an object only while it
    shows a page, and an embed never says. */
export interface DomFrame {
  url: string;
  visible: boolean;
  framed: boolean;
}

export interface ViewPoint {
  x: number;
  y: number;
}

/** How a page read reads its child frames: the contract's limits and host
    lists. A screenshot's read passes none and reads no frame. */
export interface FrameReadRules {
  read: number;
  elements: number;
  text: number;
  minPx: number;
  paymentHosts: readonly string[];
  signInHosts: readonly string[];
}

export const FRAME_READ_RULES: FrameReadRules = {
  read: FRAMES_READ,
  elements: ELEMENTS_PER_FRAME,
  text: TEXT_PER_FRAME,
  minPx: FRAME_MIN_READ_PX,
  paymentHosts: PAYMENT_FRAME_HOSTS,
  signInHosts: SIGN_IN_FRAME_HOSTS,
};

/** A child frame a click can land in, as a page read finds it: its address
    (the document's own for a frame the read reaches, else its owner's src), its
    content box in viewport CSS pixels, and what a read frame holds. */
export type RawFrame =
  | { url: string; read: false; box: Box; offscreen: boolean }
  | { url: string; read: true; box: Box; offscreen: boolean; elements: PageFrameElement[]; text: string; truncated: boolean };

/** Where the focus is for a key: on a secret field, or in a frame from
    another site, whose fields this world can't read. */
export interface FocusedSecret {
  secret: boolean;
  otherSite: boolean;
}

/** What a screenshot must not show, in viewport CSS pixels: secret fields
    (in the page, its open shadow roots and its same-origin frames), payment
    frames by address, and every frame from another site. */
export interface FoundSecrets {
  secrets: Box[];
  paymentFrames: Box[];
  otherSiteFrames: Box[];
  viewport: { width: number; height: number };
}

export type PageWorldRequest =
  | { kind: 'snapshot'; maxText: number; maxElements: number; frames: FrameReadRules | null }
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
  /* Which of `points` (viewport CSS pixels) a click reaches element `id` at. */
  | { kind: 'hitTest'; id: number; points: ViewPoint[] }
  /* Whether a click at `point` lands in a frame, or where this world can't see. */
  | { kind: 'intoFrame'; point: ViewPoint }
  /* A step's change watch, under the step's token. `at` is where the step's
     pointer ended, or null for a step without one. */
  | { kind: 'changeStart'; token: number }
  | { kind: 'changeMark'; token: number; at: ViewPoint | null }
  | { kind: 'changeStop'; token: number }
  | { kind: 'secretBoxes'; paymentHosts: readonly string[] }
  | { kind: 'watch' };

export interface RawSnapshot {
  url: string;
  title: string;
  scroll: PageScroll;
  elements: PageElement[];
  text: string;
  /** More shown elements exist than `elements` lists. */
  truncated: boolean;
  /** Every frame owner in the page's DOM (open shadow roots included):
      whether the person can see it (a non-empty box in the viewport, not
      hidden or transparent), and whether it holds a frame. */
  frameOwners: DomFrame[];
  /** The ones a click can land in, on-screen first, and what a read one holds. */
  frames: RawFrame[];
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

/** The first of a hit test's points whose hit lands on the element, inside
    it or on one of its labels, and not in a frame there; -1 when every one
    lands on something else. `intoFrame`: a point landed in a frame owner, or
    in a custom element sealed from this world, inside the element or one of
    its labels. */
export type HitTestResult = { found: false } | { found: true; reaches: number; intoFrame: boolean };

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
  /* A cut that never splits a character in two. */
  const cut = (text: string, max: number): string => {
    const head = text.slice(0, max);
    return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
  };

  const tagOf = (el: Element): string => el.tagName.toLowerCase();
  const inputType = (el: Element): string => (el.getAttribute('type') || 'text').toLowerCase();
  const editable = (el: Element): boolean => {
    const value = el.getAttribute('contenteditable');
    return value === '' || value === 'true' || value === 'plaintext-only';
  };
  /* Editable as part of an editor, its own attribute or not. */
  const contentEditable = (el: Element | null): boolean => (el as HTMLElement | null)?.isContentEditable === true;
  /* The element's own window's computed style, for an element of a frame too. */
  const styleOf = (el: Element): CSSStyleDeclaration => (el.ownerDocument.defaultView ?? win).getComputedStyle(el);
  const boxOf = (el: Element): Box => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  };
  /* Whether a click can land on the element: a non-empty box, laid out and
     not hidden. A transparent one takes clicks as any other, and its style
     can turn it back on as the pointer arrives, so neither opacity nor
     pointer-events counts. */
  const takesClicks = (el: Element, box: Box): boolean => {
    if (box.width <= 0 || box.height <= 0) return false;
    const style = win.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  /* Whether the person can see it: it takes clicks, and isn't transparent. */
  const shown = (el: Element, box: Box): boolean => takesClicks(el, box) && Number(win.getComputedStyle(el).opacity || '1') > 0;
  const inView = (box: Box, view: { width: number; height: number } = viewport): boolean =>
    box.x < view.width && box.y < view.height && box.x + box.width > 0 && box.y + box.height > 0;
  /* The box inside an element's border and padding: a frame's own viewport. */
  const contentBox = (el: Element): Box => {
    const box = boxOf(el);
    const style = styleOf(el);
    const px = (value: string) => parseFloat(value) || 0;
    const left = px(style.borderLeftWidth) + px(style.paddingLeft);
    const top = px(style.borderTopWidth) + px(style.paddingTop);
    const right = px(style.borderRightWidth) + px(style.paddingRight);
    const bottom = px(style.borderBottomWidth) + px(style.paddingBottom);
    return { x: box.x + left, y: box.y + top, width: Math.max(0, box.width - left - right), height: Math.max(0, box.height - top - bottom) };
  };
  /* A frame owner's document, when this world may read it: same origin. An
     embed shows none. */
  const frameDocOf = (owner: Element): Document | null => {
    try {
      return (owner as HTMLIFrameElement).contentDocument ?? null;
    } catch {
      return null;
    }
  };
  /* The address a frame owner names: an object's data, the others' src. */
  const sourceOf = (owner: Element): string =>
    (tagOf(owner) === 'object' ? (owner as HTMLObjectElement).data : (owner as HTMLIFrameElement).src) || '';
  /* Whether `address`'s host is one of `hosts`, or a name under one. */
  const hostIn = (address: string, hosts: readonly string[]): boolean => {
    let host: string;
    try {
      host = new URL(address).hostname.toLowerCase().replace(/\.+$/, '');
    } catch {
      return false;
    }
    return !!host && hosts.some((domain) => host === domain || host.endsWith(`.${domain}`));
  };
  /* An OAuth authorization request or consent page, by its address. */
  const CONSENT_SEGMENTS = new Set(['authorize', 'authorization', 'oauth', 'oauth2', 'openid', 'openid-connect', 'login-actions']);
  const consentPage = (address: string): boolean => {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return false;
    }
    const query = url.searchParams;
    if (query.has('client_id') && ['response_type', 'redirect_uri', 'request_uri'].some((key) => query.has(key))) return true;
    return url.pathname.toLowerCase().split('/').some((part) => CONSENT_SEGMENTS.has(part) || part.startsWith('consent'));
  };
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

  /* Whether `el` is a secret editor or inside one: its editing host, the
     nearest element whose contenteditable makes it editable, is secret. */
  const inSecretEditor = (el: Element): boolean => {
    const host = el.closest('[contenteditable]');
    return !!host && editable(host) && isSecret(host);
  };
  const holdsSecretEditor = (root: ParentNode): boolean =>
    Array.from(root.querySelectorAll('[contenteditable]')).some((el) => editable(el) && isSecret(el));
  /* The text of `node` and below it, a secret field's subtree and `skip`
     left out. */
  const textWithoutSecrets = (node: Node, skip: Node | null = null): string => {
    let text = '';
    const walk = (at: Node) => {
      if (at === skip) return;
      if (at.nodeType === 3) text += at.textContent || '';
      else if (at.nodeType !== 1 || !isSecret(at as Element)) at.childNodes.forEach(walk);
    };
    walk(node);
    return text;
  };
  /* An element's text as a name may show it: none for a secret editor, and
     a secret field inside it left out. With no secret editor inside, it is
     `source` as before, so ordinary names don't change. */
  const shownText = (el: Element, source: 'innerText' | 'textContent'): string => {
    if (inSecretEditor(el)) return '';
    if (holdsSecretEditor(el)) return textWithoutSecrets(el);
    return source === 'innerText' ? textOf(el) : el.textContent ?? '';
  };

  /* A label's own words: a label that wraps its control would otherwise name a
     list box after every option in it. */
  const labelText = (label: Element, control: Element): string =>
    (inSecretEditor(label) ? '' : textWithoutSecrets(label, control));

  const nameOf = (el: Element, role: string): string => {
    const aria = clean(el.getAttribute('aria-label'), 120);
    if (aria) return aria;
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const named = labelledBy.split(/\s+/).map((id) => {
        const target = el.ownerDocument.getElementById(id);
        return target ? shownText(target, 'textContent') : '';
      });
      const text = clean(named.join(' '), 120);
      if (text) return text;
    }
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) {
      const text = clean(Array.from(labels).map((label) => labelText(label, el)).join(' '), 120);
      if (text) return text;
    }
    const tag = tagOf(el);
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(inputType(el))) {
      return clean((el as HTMLInputElement).value || inputType(el), 120);
    }
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'listbox' || role === 'spinbutton') {
      const hint = clean(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name'), 120);
      if (hint) return hint;
    }
    const text = clean(shownText(el, 'innerText'), 120);
    if (text) return text;
    const img = el.querySelector('img[alt]');
    return clean(img?.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder'), 120);
  };

  const selectValue = (select: HTMLSelectElement): string =>
    clean(Array.from(select.selectedOptions).map((o) => o.label || o.text).join(', '), MAX_VALUE_CHARS);
  const selectOptions = (select: HTMLSelectElement): string[] => Array.from(select.options).slice(0, 50).map((o) => clean(o.label || o.text, 120));
  const checkedOf = (el: Element): boolean => {
    const aria = el.getAttribute('aria-checked');
    return aria !== null ? aria === 'true' : (el as HTMLInputElement).checked === true;
  };

  const describe = (el: Element, id: number, role: string, offscreen: boolean): Record<string, unknown> => {
    const entry: Record<string, unknown> = { id, role, name: nameOf(el, role) };
    const tag = tagOf(el);
    if (isSecret(el)) {
      entry.value_hidden = true;
      if (tag === 'input' && inputType(el) === 'password') entry.type = 'password';
    } else if (tag === 'select') {
      entry.value = selectValue(el as HTMLSelectElement);
      entry.options = selectOptions(el as HTMLSelectElement);
    } else if (tag === 'textarea' || (tag === 'input' && role !== 'button' && role !== 'checkbox' && role !== 'radio')) {
      const value = (el as HTMLInputElement).value;
      if (value) entry.value = value.slice(0, MAX_VALUE_CHARS);
    } else if (editable(el)) {
      const value = clean(el.textContent, MAX_VALUE_CHARS);
      if (value) entry.value = value;
    }
    if (role === 'checkbox' || role === 'radio' || role === 'switch') entry.checked = checkedOf(el);
    if (isDisabled(el)) entry.disabled = true;
    if (offscreen) entry.offscreen = true;
    return entry;
  };

  /* An element of a frame as a read lists it: no id, and no field value but
     a select's. */
  const describeInFrame = (el: Element, role: string, offscreen: boolean): PageFrameElement => {
    const entry: PageFrameElement = { role, name: nameOf(el, role) };
    if (tagOf(el) === 'select') {
      entry.value = selectValue(el as HTMLSelectElement);
      entry.options = selectOptions(el as HTMLSelectElement);
    }
    if (role === 'checkbox' || role === 'radio' || role === 'switch') entry.checked = checkedOf(el);
    if (isDisabled(el)) entry.disabled = true;
    if (offscreen) entry.offscreen = true;
    return entry;
  };

  const elementsIn = (root: Node): Element[] => {
    const found: Element[] = [];
    const visit = (from: Node) => {
      const walker = (from.ownerDocument ?? (from as Document)).createTreeWalker(from, 1);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node as Element;
        found.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(root);
    return found;
  };

  /* Today's page text: innerText, with runs of spaces and blank lines folded. */
  const fullText = (d: Document): string =>
    (d.body ? textOf(d.body) : '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

  /* Whether the person scrolled away from the top: the page, or a scrolled
     box around the middle of the view. */
  const scrolledAway = (d: Document): boolean => {
    const view = d.defaultView;
    if (!view) return false;
    if (view.scrollY > 0) return true;
    for (let el = d.elementFromPoint(view.innerWidth / 2, view.innerHeight / 2); el; el = el.parentElement) {
      if (el.scrollTop > 0 && /^(auto|scroll)$/.test(styleOf(el).overflowY)) return true;
    }
    return false;
  };

  /* Elements whose text a person never reads as the page's. */
  const UNREAD_TEXT = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'select', 'option', 'title']);

  /*
   * The page's text in reading order, the light DOM innerText reads, with
   * secret fields and editors left out. `above` holds the text nodes whose
   * every line sits above the view, or above a scrolled box they are in;
   * `shown` the rest. Rects come from a detached Range, so nothing is
   * selected, scrolled or focused.
   */
  const textByView = (d: Document): { all: string; shown: string; above: string } => {
    const all: string[] = [];
    const shownParts: string[] = [];
    const aboveParts: string[] = [];
    const range = d.createRange();
    const walk = (node: Node, clipTop: number): void => {
      if (node.nodeType === 3) {
        const parent = node.parentElement;
        const visibility = parent ? styleOf(parent).visibility : 'hidden';
        if (visibility === 'hidden' || visibility === 'collapse') return;
        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects());
        if (!rects.length) return;
        const text = node.textContent || '';
        all.push(text);
        (rects.every((rect) => rect.bottom <= clipTop) ? aboveParts : shownParts).push(text);
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node as Element;
      if (UNREAD_TEXT.has(tagOf(el)) || isSecret(el)) return;
      const style = styleOf(el);
      if (style.display === 'none') return;
      const check = (el as Element & { checkVisibility?: () => boolean }).checkVisibility;
      if (style.display !== 'contents' && typeof check === 'function' && !check.call(el)) return;
      const top = el.scrollTop > 0 ? Math.max(clipTop, el.getBoundingClientRect().top + el.clientTop) : clipTop;
      // Words in separate blocks, or either side of a line break, stay apart.
      const apart = tagOf(el) === 'br' || (style.display !== 'contents' && !style.display.startsWith('inline'));
      if (apart) for (const parts of [all, shownParts, aboveParts]) parts.push(' ');
      el.childNodes.forEach((child) => walk(child, top));
      if (apart) for (const parts of [all, shownParts, aboveParts]) parts.push(' ');
    };
    if (d.body) walk(d.body, 0);
    return { all: all.join(''), shown: shownParts.join(''), above: aboveParts.join('') };
  };

  /*
   * The page's text, at most `maxText` characters. A page that isn't
   * scrolled, or whose text fits, reads as innerText always has. Scrolled
   * past what fits, it starts at the top of the view after a leading '…',
   * and the start of the text above the view follows when the budget allows.
   * A secret editor's text is never in it.
   */
  const pageText = (d: Document, maxText: number): string => {
    if (maxText <= 0) return '';
    const full = fullText(d);
    const scrolled = scrolledAway(d);
    const secret = holdsSecretEditor(d);
    if (!secret && (full.length <= maxText || !scrolled)) return cut(full, maxText);
    const { all, shown: inView, above } = textByView(d);
    const everything = clean(all, Infinity);
    if (!scrolled || everything.length <= maxText) return cut(everything, maxText);
    let text = cut(clean(`… ${inView}`, Infinity), maxText);
    const before = clean(above, Infinity);
    if (before && text.length < maxText - 50) text = cut(`${text} … (above the view) ${before}`, maxText);
    return text;
  };

  /* An element's id, minted the first time a read lists it. */
  const idOf = (el: Element): number => {
    let id = world.byElement.get(el);
    if (id === undefined) {
      id = world.next;
      world.next += 1;
      world.byElement.set(el, id);
      world.ids.set(id, el);
    }
    return id;
  };

  /* Elements that may hold another document: a click on one lands in it. */
  const FRAME_TAGS = new Set(['iframe', 'frame', 'object', 'embed']);
  const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
  /* Whether a frame owner holds one of its document's child frames, as
     DomFrame's `framed` says. An SVG element named iframe holds none. */
  const holdsFrame = (owner: Element): boolean => owner.namespaceURI === HTML_NAMESPACE
    && (tagOf(owner) === 'iframe' || tagOf(owner) === 'frame' || (tagOf(owner) === 'object' && !!(owner as HTMLObjectElement).contentWindow));

  interface Candidate { el: Element; role: string; box: Box; visible: boolean }

  /* The shown elements with a role under `root` (open shadow roots
     included), each with its box and whether it is in `view`, and the frame
     owners, which are never elements. */
  const collect = (root: Node | null, view: { width: number; height: number }): { candidates: Candidate[]; owners: Element[] } => {
    const candidates: Candidate[] = [];
    const owners: Element[] = [];
    for (const el of root ? elementsIn(root) : []) {
      if (FRAME_TAGS.has(tagOf(el))) {
        owners.push(el);
        continue;
      }
      const role = roleOf(el);
      if (!role) continue;
      const box = boxOf(el);
      if (!shown(el, box)) continue;
      candidates.push({ el, role, box, visible: inView(box, view) });
    }
    return { candidates, owners };
  };

  /* Every candidate in page order when they all fit; past `max`, the ones
     in view first, then the rest, each group in page order. */
  const listed = (candidates: Candidate[], max: number): Candidate[] => (candidates.length <= max
    ? candidates
    : [...candidates.filter((c) => c.visible), ...candidates.filter((c) => !c.visible)].slice(0, max));

  /* A field that says a frame holds something only the person handles: a
     secret field (password, one-time code, card), a field named for a card,
     or a sign-in field. */
  const CARD_FIELD_NAME = /(^|[^a-z])(cvc|cvv2?|csc)([^a-z]|$)|card[\s_-]*(number|num|no)|cc[\s_-]*num|security[\s_-]*code/i;
  const SIGN_IN_AUTOCOMPLETE = /(^|\s)(username|webauthn)(\s|$)/;
  const isField = (el: Element): boolean => ['input', 'textarea', 'select'].includes(tagOf(el)) || editable(el);
  const holdsPrivateField = (root: Node): boolean => elementsIn(root).some((el) => isField(el) && (
    isSecret(el)
    || SIGN_IN_AUTOCOMPLETE.test((el.getAttribute('autocomplete') || '').toLowerCase())
    || ['name', 'id', 'aria-label', 'placeholder'].some((attr) => CARD_FIELD_NAME.test(el.getAttribute(attr) || ''))));

  /* The frames among `owners` a click can land in, transparent ones
     included, on-screen first, each read when the rules let it: a shown,
     same-origin frame at least `minPx` each way, within the first `read`
     frames read, on no payment, sign-in or consent address (its src's or its
     document's), and holding no private field. */
  const readFrames = (owners: Element[], rules: FrameReadRules): RawFrame[] => {
    const placed = owners
      .filter((owner) => takesClicks(owner, boxOf(owner)))
      .map((owner) => {
        const box = contentBox(owner);
        return { owner, box, offscreen: !inView(box), seen: shown(owner, boxOf(owner)) };
      });
    let reads = 0;
    return [...placed.filter((f) => !f.offscreen), ...placed.filter((f) => f.offscreen)].map(({ owner, box, offscreen, seen }): RawFrame => {
      const inner = frameDocOf(owner);
      const src = sourceOf(owner);
      const url = inner ? String(inner.location?.href || src) : src;
      const refusedAddress = (address: string) =>
        hostIn(address, rules.paymentHosts) || hostIn(address, rules.signInHosts) || consentPage(address);
      if (!inner || !seen || reads >= rules.read || box.width < rules.minPx || box.height < rules.minPx
        || refusedAddress(src) || refusedAddress(url) || holdsPrivateField(inner)) {
        return { url, read: false, box, offscreen };
      }
      reads += 1;
      const view = { width: inner.defaultView?.innerWidth ?? 0, height: inner.defaultView?.innerHeight ?? 0 };
      const { candidates } = collect(inner.body || inner.documentElement, view);
      return {
        url,
        read: true,
        box,
        offscreen,
        elements: listed(candidates, rules.elements).map(({ el, role, visible }) => describeInFrame(el, role, !visible)),
        text: pageText(inner, rules.text),
        truncated: candidates.length > rules.elements,
      };
    });
  };

  /*
   * Every shown element is listed in page order when they all fit. Past
   * `maxElements`, the ones in view first, then the rest, each group in
   * page order, and `truncated` says more exist. Only listed elements get an
   * id. Frames are never elements: each one is a frame owner, and the ones a
   * click can land in are listed as frames.
   */
  const snapshot = (maxText: number, maxElements: number, frameRules: FrameReadRules | null) => {
    for (const [id, el] of world.ids) {
      if (!el.isConnected) {
        world.ids.delete(id);
        world.byElement.delete(el);
      }
    }
    const { candidates, owners } = collect(doc.body || doc.documentElement, viewport);
    const elements: Record<string, unknown>[] = [];
    const boxes: ElementBox[] = [];
    for (const { el, role, box, visible } of listed(candidates, maxElements)) {
      const id = idOf(el);
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
    const frameOwners = owners.map((owner): DomFrame => {
      const box = boxOf(owner);
      return { url: sourceOf(owner), visible: shown(owner, box) && inView(box), framed: holdsFrame(owner) };
    });
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
      text: pageText(doc, maxText),
      truncated: candidates.length > maxElements,
      frameOwners,
      frames: frameRules ? readFrames(owners, frameRules) : [],
      boxes,
      viewport,
    };
  };

  /* What a screenshot must not show. Same-origin frames are searched in
     turn, offset by their content box; a frame from another site can't be. */
  const secretBoxes = (paymentHosts: readonly string[]): FoundSecrets => {
    const found: FoundSecrets = { secrets: [], paymentFrames: [], otherSiteFrames: [], viewport };
    const add = (into: Box[], el: Element, dx: number, dy: number) => {
      const box = boxOf(el);
      if (box.width > 0 && box.height > 0) into.push({ x: box.x + dx, y: box.y + dy, width: box.width, height: box.height });
    };
    const visit = (root: Node, dx: number, dy: number, depth: number) => {
      if (depth > 8) return;
      for (const el of elementsIn(root)) {
        if (!FRAME_TAGS.has(tagOf(el))) {
          if (isField(el) && isSecret(el)) add(found.secrets, el, dx, dy);
          continue;
        }
        const inner = frameDocOf(el);
        const payment = hostIn(sourceOf(el), paymentHosts) || (!!inner && hostIn(String(inner.location?.href || ''), paymentHosts));
        if (payment) add(found.paymentFrames, el, dx, dy);
        if (!inner) add(found.otherSiteFrames, el, dx, dy);
        else if (!payment) {
          const box = contentBox(el);
          visit(inner, dx + box.x, dy + box.y, depth + 1);
        }
      }
    };
    visit(doc, 0, 0, 0);
    return found;
  };

  /* The focused element, followed into open shadow roots and same-origin
     frames. A frame from another site keeps the focus on its owner. */
  const deepActive = (): Element | null => {
    let active = doc.activeElement;
    for (;;) {
      const inFrame = active && FRAME_TAGS.has(tagOf(active)) ? frameDocOf(active) : null;
      const inner = active?.shadowRoot?.activeElement ?? inFrame?.activeElement ?? null;
      if (!inner || inner === active || inner === inner.ownerDocument.body) return active;
      active = inner;
    }
  };

  /* A node's parent, or a shadow root's host. */
  const parentAcross = (node: Node): Node | null => node.parentNode ?? (node.nodeType === 11 ? (node as ShadowRoot).host ?? null : null);

  /* Whether `node` is `el` or inside it, across shadow roots. */
  const within = (el: Node, node: Node | null): boolean => {
    for (let at = node; at; at = parentAcross(at)) if (at === el) return true;
    return false;
  };

  /* The element a click at (x, y) lands on, followed into open shadow roots. */
  const hitAt = (x: number, y: number): Element | null => {
    let hit = doc.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    return hit;
  };

  /* Whether a click that lands on `hit` lands on `el`: it is `el`, inside
     it, or on one of its labels. */
  const landsOn = (el: Element, hit: Element): boolean =>
    within(el, hit) || Array.from((el as HTMLInputElement).labels ?? []).some((label) => within(label, hit));

  /* Whether (x, y) lies on text `el` holds itself, which a click there lands
     on. */
  const ownTextAt = (el: Element, x: number, y: number): boolean => {
    const range = el.ownerDocument.createRange();
    return Array.from(el.childNodes).some((child) => {
      if (child.nodeType !== 3) return false;
      range.selectNodeContents(child);
      return Array.from(range.getClientRects()).some((rect) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom);
    });
  };

  /* Whether a click on `hit` at (x, y) lands where this world can't see: in
     a frame owner's document, or in a custom element that shows no open
     shadow root and has no text of its own there, whose closed shadow root
     may hold a frame. */
  const opaqueHit = (hit: Element, x: number, y: number): boolean =>
    FRAME_TAGS.has(tagOf(hit)) || (tagOf(hit).includes('-') && !hit.shadowRoot && !ownTextAt(hit, x, y));

  /* Whether the focus is on `el` or inside it, across shadow roots, or on the
     editing host `el` is part of. */
  const focusIn = (el: Element): boolean => {
    const active = deepActive();
    if (within(el, active)) return true;
    return contentEditable(el) && contentEditable(active) && !!active?.contains(el);
  };

  const focusOnSecret = (): boolean => {
    const active = deepActive();
    return !!active && active !== doc.body && isSecret(active);
  };

  /* The focus rests on a frame this world can't read. */
  const focusInOtherSite = (): boolean => {
    const active = deepActive();
    return !!active && FRAME_TAGS.has(tagOf(active)) && !frameDocOf(active);
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

  /* What a change watch can't see into when it is in view. */
  const OPAQUE = 'iframe, frame, canvas, video, audio, object, embed';
  const CHANGE_EVENTS = ['scroll', 'input', 'change', 'toggle'];
  const now = (): number => win.performance.now();

  const observeRoot = (watch: ChangeWatch, root: Node): void => {
    if (watch.observed.has(root)) return;
    watch.observed.add(root);
    watch.roots.push(root);
    watch.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  };
  /* Observes every open shadow root at `node` and below it. */
  const observeShadowRoots = (watch: ChangeWatch, node: Node): void => {
    const top = node.nodeType === 1 ? [node as Element] : [];
    const own = top[0]?.shadowRoot;
    for (const el of [...top, ...elementsIn(node), ...(own ? elementsIn(own) : [])]) {
      if (el.shadowRoot) observeRoot(watch, el.shadowRoot);
    }
  };
  const countRecords = (watch: ChangeWatch, records: MutationRecord[]): void => {
    for (const record of records) {
      watch.changes += 1;
      if (record.type !== 'attributes' || record.attributeName !== 'style') watch.lastContentAt = now();
      if (record.type === 'childList') {
        record.addedNodes.forEach((node) => {
          if (node.nodeType === 1) observeShadowRoots(watch, node);
        });
      }
    }
  };
  const stopChanges = (): void => {
    const watch = world.change;
    if (!watch) return;
    watch.observer.disconnect();
    for (const type of CHANGE_EVENTS) win.removeEventListener(type, watch.listener, true);
    world.change = null;
  };
  /* A custom element that shows no open shadow root may keep a closed one,
     whose changes no observer here sees. */
  const mayBeSealed = (el: Element | null): boolean => !!el && el.localName.includes('-') && !el.shadowRoot;
  const opaqueNow = (watch: ChangeWatch, at: ViewPoint | null): boolean => {
    const inViewNow = watch.roots.some((root) => Array.from((root as ParentNode).querySelectorAll(OPAQUE)).some((el) => {
      const box = boxOf(el);
      return shown(el, box) && inView(box);
    }));
    return inViewNow || mayBeSealed(at ? hitAt(at.x, at.y) : null) || mayBeSealed(deepActive());
  };
  const busyNow = (watch: ChangeWatch): boolean => watch.roots.some((root) =>
    Array.from((root as ParentNode).querySelectorAll('[aria-busy="true"]')).some((el) => shown(el, boxOf(el))));

  switch (request.kind) {
    case 'snapshot':
      return snapshot(request.maxText, request.maxElements, request.frames);
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
      return { secret: focusOnSecret(), otherSite: focusInOtherSite() } satisfies FocusedSecret;
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
    case 'hitTest': {
      const el = world.ids.get(request.id);
      if (!el || !el.isConnected) return { found: false };
      let intoFrame = false;
      const reaches = request.points.findIndex(({ x, y }) => {
        const hit = hitAt(x, y);
        if (!hit || !landsOn(el, hit)) return false;
        if (!opaqueHit(hit, x, y)) return true;
        intoFrame = true;
        return false;
      });
      return { found: true, reaches, intoFrame } satisfies HitTestResult;
    }
    case 'intoFrame': {
      const { x, y } = request.point;
      const hit = hitAt(x, y);
      return !!hit && opaqueHit(hit, x, y);
    }
    case 'changeStart': {
      stopChanges();
      const watch: ChangeWatch = {
        token: request.token,
        changes: 0,
        lastContentAt: now(),
        observer: new MutationObserver((records) => countRecords(watch, records)),
        roots: [],
        observed: new WeakSet(),
        listener: () => { watch.changes += 1; },
      };
      for (const type of CHANGE_EVENTS) win.addEventListener(type, watch.listener, { capture: true, passive: true });
      world.change = watch;
      observeRoot(watch, doc);
      observeShadowRoots(watch, doc);
      return { ok: true };
    }
    case 'changeMark': {
      const watch = world.change;
      if (!watch || watch.token !== request.token) return null;
      countRecords(watch, watch.observer.takeRecords());
      return {
        changes: watch.changes,
        sinceLastMs: Math.max(0, now() - watch.lastContentAt),
        busy: busyNow(watch),
        opaque: opaqueNow(watch, request.at),
      } satisfies ChangeMark;
    }
    case 'changeStop':
      if (world.change?.token === request.token) stopChanges();
      return { ok: true };
    case 'secretBoxes':
      return secretBoxes(request.paymentHosts);
    case 'watch':
      world.observer ??= new MutationObserver(onMutations);
      watchRoot(doc);
      markSecrets(doc);
      return { ok: true };
  }
}

/** The longest frame address a page answer carries. */
const MAX_FRAME_ADDRESS = 1024;

/** A frame's address as a page answer gives it: origin and path for http
    and https, about:blank or about:srcdoc, otherwise the scheme alone. */
export function frameAddress(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return 'about:blank';
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return `${url.origin}${url.pathname}`.slice(0, MAX_FRAME_ADDRESS);
  if (url.protocol === 'about:') return url.pathname === 'srcdoc' ? 'about:srcdoc' : 'about:blank';
  return url.protocol;
}

/** Whether a frame address is a payment provider's (PAYMENT_FRAME_HOSTS). */
export function isPaymentAddress(address: string): boolean {
  let host: string;
  try {
    host = new URL(address).hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    return false;
  }
  return !!host && PAYMENT_FRAME_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/* The addresses of the main frame's child frames the page read can't place.
   Each owner that holds a frame (`framed`) holds one of them, so the two
   number the same unless the DOM hides one (in a closed shadow root, or
   behind an embed) or the tree and the DOM disagree. Then it gives the
   children no such owner's address matches, or every child when each one
   matched, so that a count off in either direction holds every click by
   position on the page. */
function unplacedFrames(childFrameUrls: string[], owners: DomFrame[]): string[] {
  const framed = owners.filter((owner) => owner.framed);
  if (framed.length === childFrameUrls.length) return [];
  const sources = framed.map((owner) => owner.url);
  const unmatched = childFrameUrls.filter((url) => {
    const at = sources.indexOf(url);
    if (at === -1) return true;
    sources.splice(at, 1);
    return false;
  });
  return unmatched.length ? unmatched : childFrameUrls;
}

/** The page answer anton reads: the read without main's own fields, with the
    checks the person can see, and the page's child frames (`childFrameUrls`,
    the main frame's direct children) in screenshot pixels. A check frame's
    content never leaves main. */
export function pageAnswer(raw: RawSnapshot, challenges: Challenge[], childFrameUrls: string[]): PageSnapshot {
  const scale = screenshotScale(raw.viewport.width);
  /* Outward to whole pixels, as renderScreenshot's masks: a click at any
     screenshot point that lands in the frame is inside its box. */
  const inShot = (box: Box): FrameBox => {
    const x = Math.floor(box.x / scale);
    const y = Math.floor(box.y / scale);
    return { x, y, width: Math.ceil((box.x + box.width) / scale) - x, height: Math.ceil((box.y + box.height) / scale) - y };
  };
  const frames = raw.frames.map((frame): PageFrame => {
    const where = { url: frameAddress(frame.url), box: inShot(frame.box), ...(frame.offscreen ? { offscreen: true as const } : {}) };
    if (!frame.read || challengeKind(frame.url) !== null) return { ...where, read: false };
    return { ...where, read: true, elements: frame.elements, text: frame.text, truncated: frame.truncated };
  });
  for (const url of unplacedFrames(childFrameUrls, raw.frameOwners)) frames.push({ url: frameAddress(url), read: false, box: null });
  return {
    url: raw.url,
    title: raw.title,
    scroll: raw.scroll,
    elements: raw.elements,
    text: raw.text,
    truncated: raw.truncated,
    challenges,
    frames,
  };
}

/** What a screenshot blacks out: secret fields and payment frames, and every
    frame from another site when the frame tree (`frameUrls`) holds a payment
    frame the page's DOM doesn't account for (one nested in another site's
    frame, or one that navigated there). */
export function screenshotMasks(found: FoundSecrets, frameUrls: string[]): Box[] {
  const unaccounted = frameUrls.filter(isPaymentAddress).length > found.paymentFrames.length;
  return [...found.secrets, ...found.paymentFrames, ...(unaccounted ? found.otherSiteFrames : [])];
}

/* The isolated world's own global holds the state between reads. That global
   belongs to the isolated world, not to the page, so the page never sees it. */
const WORLD_STATE_KEY = '__coworkBrowserWorld';

/** The source text that runs `request` in the isolated world. */
export function pageWorldSource(request: PageWorldRequest): string {
  const state = `globalThis[${JSON.stringify(WORLD_STATE_KEY)}] ??= { ids: new Map(), byElement: new WeakMap(), next: 1, secret: new WeakSet(), observer: null, watched: new WeakSet(), change: null }`;
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
