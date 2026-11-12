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
 * one included, with its content box, and reads the ones it may: a
 * same-origin frame the person sees (enough of it in view, drawn near its
 * size, not faint, masked, blended or filtered out of sight, and found by a
 * hit test at most of its sample points), big enough, within the read cap,
 * on no payment, sign-in or consent address, and holding no secret, card or
 * sign-in field; main then keeps it read only where its box, as the page
 * draws it, shows more than one color (browser-view.ts). A read
 * frame's elements have no id and no field value, and no editor's text
 * reaches its text or a name there. A frame from another site can't be read
 * from here: this world runs in the view's main frame, and the page's DOM
 * gives it no way into another site's document; a page read attaches no
 * debugger, which would open a world in that frame, so that frame is listed
 * unread. A step
 * or a screenshot, which attach the debugger, read its focus and its secret
 * fields in that frame's own isolated world (browser-frames.ts).
 * `secretBoxes` finds what every screenshot blacks out.
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

/** How many same-origin frames deep a screenshot's search for secrets goes
    (`secretBoxes`). The frame tree is counted to the same depth
    (browser-view.ts), so the two can be compared. */
export const SECRET_SEARCH_DEPTH = 8;

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
    lists. A screenshot's read passes none and reads no frame. The page's
    world reads up to `candidates` frames, and ElectronTab.read keeps the
    first `read` of them its look finds the person sees (browser-view.ts),
    so a frame the look leaves unread takes none of those reads. */
export interface FrameReadRules {
  read: number;
  candidates: number;
  elements: number;
  text: number;
  minPx: number;
  paymentHosts: readonly string[];
  signInHosts: readonly string[];
}

export const FRAME_READ_RULES: FrameReadRules = {
  read: FRAMES_READ,
  candidates: 2 * FRAMES_READ,
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

/** Where the focus is for a key: on a secret field, in a frame from
    another site, whose fields this world can't read, or on an element that
    may keep a closed shadow root (`sealed`), which no world sees into, so
    the focus may sit on a field inside it. */
export interface FocusedSecret {
  secret: boolean;
  otherSite: boolean;
  sealed: boolean;
}

/** What a screenshot must not show, in viewport CSS pixels: secret fields
    (in the page, its open shadow roots and its same-origin frames, placed
    where each frame draws them, or the whole frame where a transform or an
    offset path turns it) and the copies -webkit-box-reflect draws of them,
    payment frames by address, every frame the search doesn't enter (one
    from another site, or a same-origin one past SECRET_SEARCH_DEPTH), and
    the copies -webkit-box-reflect draws of any frame (`mirroredFrames`),
    whole. `owners` counts the frame owners that hold a frame (DomFrame's
    `framed`) in the documents it searched. */
export interface FoundSecrets {
  secrets: Box[];
  paymentFrames: Box[];
  otherSiteFrames: Box[];
  mirroredFrames: Box[];
  owners: number;
  viewport: { width: number; height: number };
}

export type PageWorldRequest =
  | { kind: 'snapshot'; maxText: number; maxElements: number; frames: FrameReadRules | null }
  | { kind: 'locate'; id: number; reveal: boolean }
  | { kind: 'focusedSecret' }
  /* The frame owner the focus rests on where this world reaches no further
     (a frame of another site), or null. It answers an element, which only a
     read through the debugger takes (browser-frames.ts). */
  | { kind: 'focusedFrame' }
  /* The element the focus rests on, followed as far as this world sees, or
     null. It answers an element, for the debugger to look inside. */
  | { kind: 'focusedElement' }
  /* The text entry that isn't secret where the focus rests, which a type
     with focused true types into, or null. It answers an element, which the
     debugger names by its node (browser-frames.ts). */
  | { kind: 'focusedEntry' }
  /* Where the focus is while a type step types into element `id`. */
  | { kind: 'typingFocus'; id: number }
  | { kind: 'viewport' }
  /* Focuses a text field for typing; with `select`, selects its text so typing replaces it. */
  | { kind: 'focusField'; id: number; select: boolean }
  /* Focuses an element for a key press; `editing` when the key edits text. */
  | { kind: 'focus'; id: number; editing: boolean }
  | { kind: 'select'; id: number; values: string[] }
  /* Which of `points` (viewport CSS pixels) a click reaches element `id` at.
     `childFrames`: how many child frames the frame tree gives the main frame. */
  | { kind: 'hitTest'; id: number; points: ViewPoint[]; childFrames: number }
  /* A step's change watch, under the step's token. `at` is where the step's
     pointer ended, or null for a step without one. */
  | { kind: 'changeStart'; token: number }
  | { kind: 'changeMark'; token: number; at: ViewPoint | null }
  | { kind: 'changeStop'; token: number }
  | { kind: 'secretBoxes'; paymentHosts: readonly string[]; depth: number }
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
    lands on something else. `throughFrame`: the first point that lands in a
    frame owner, or in a custom element sealed from this world, inside the
    element or one of its labels; -1 when none does. */
export type HitTestResult = { found: false } | { found: true; reaches: number; throughFrame: number };

/** The focus before each key of a type step: whether it is on a secret field,
    and whether it is still in the field the step types into. */
export interface TypingFocus {
  secret: boolean;
  inField: boolean;
}

/**
 * One read or one small DOM step, run in the isolated world. `world` is the
 * isolated world's own state object; `request` says what to do. `from`, for
 * the focus reads only, is the closed shadow root the debugger handed this
 * world (browser-frames.ts), where they start instead of at the document.
 */
export function pageWorld(doc: Document, world: PageWorldState, request: PageWorldRequest, from?: DocumentOrShadowRoot): unknown {
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
  /* The inputs a type with focused true types into, by the type the input
     takes (an unknown type attribute is a text input). */
  const TEXT_ENTRY_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'number']);
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

  /* Editable by CSS alone (-webkit-user-modify: read-write), which takes the
     person's typing though no attribute says so and isContentEditable
     answers false. */
  const userModifiable = (el: Element): boolean => /^read-write/.test(styleOf(el).getPropertyValue('-webkit-user-modify'));
  /* Whether no read carries `el`'s text: a secret field's (an editor marked
     as a card field holds what the person typed as its text), or, in a frame
     a read reaches, an editor's, a whole editable document's included: what
     the person typed there is a field's value, which a frame read never
     carries. */
  const hidesText = (el: Element): boolean => isSecret(el) || (el.ownerDocument !== doc && (editable(el) || contentEditable(el) || userModifiable(el)));
  /* Whether `el` is such a field or inside one. */
  const inHiddenText = (el: Element): boolean => {
    for (let at: Element | null = el; at; at = at.parentElement) if (hidesText(at)) return true;
    return false;
  };
  /* Whether `root`'s own document body, or an element below `root`, holds
     such text: in the page, an editor marked secret; in a frame, any editor,
     one that CSS alone makes editable (userModifiable) included, which no
     attribute marks. */
  const holdsHiddenText = (root: ParentNode): boolean => {
    const body = (root as Document).body;
    if (body && hidesText(body)) return true;
    const inFrame = ((root as Node).ownerDocument ?? root) !== doc;
    return inFrame
      ? Array.from(root.querySelectorAll('*')).some(hidesText)
      : Array.from(root.querySelectorAll('[contenteditable]')).some((el) => editable(el) && hidesText(el));
  };
  /* The text of `node` and below it, such a field's subtree and `skip` left
     out. */
  const textWithoutHidden = (node: Node, skip: Node | null = null): string => {
    let text = '';
    const walk = (at: Node) => {
      if (at === skip) return;
      if (at.nodeType === 3) text += at.textContent || '';
      else if (at.nodeType !== 1 || !hidesText(at as Element)) at.childNodes.forEach(walk);
    };
    walk(node);
    return text;
  };
  /* An element's text as a name may show it: none for a secret field or a
     frame's editor (hidesText) or anything inside one, and with one inside
     it, the text around it. With none inside, it is `source` as before, so
     ordinary names don't change. */
  const shownText = (el: Element, source: 'innerText' | 'textContent'): string => {
    if (inHiddenText(el)) return '';
    if (holdsHiddenText(el)) return textWithoutHidden(el);
    return source === 'innerText' ? textOf(el) : el.textContent ?? '';
  };

  /* A label's own words: a label that wraps its control would otherwise name a
     list box after every option in it. */
  const labelText = (label: Element, control: Element): string =>
    (inHiddenText(label) ? '' : textWithoutHidden(label, control));

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
   * secret fields and editors, and a frame's editors, left out (hidesText).
   * On a `scrolled` page, `above` holds the text nodes whose every line
   * sits above the view, or above a scrolled box they are in; `shown` holds
   * the rest (all of them on a page that isn't). Rects come from a detached
   * Range, so nothing is selected, scrolled or focused.
   *
   * It reads only as far as a read of `maxText` characters can show, so a
   * long page costs about what its view holds, as on the web pod: it stops
   * once `shown` is longer than `maxText` as pageText cleans it, and keeps
   * text above the view only until that is. From then on a subtree drawn
   * wholly above the view, its own box and every box in it (one Range over
   * it all, which takes in a fixed or positioned box inside it), is passed
   * over whole. What it leaves out, pageText's answer never holds.
   */
  const textByView = (d: Document, maxText: number, scrolled: boolean): { all: string; shown: string; above: string } => {
    const all: string[] = [];
    const shownParts: string[] = [];
    const aboveParts: string[] = [];
    /* How long each part is so far, cleaned: no shorter than it is joined. */
    const found = { shown: 0, above: 0 };
    const range = d.createRange();
    const walk = (node: Node, clipTop: number): void => {
      if (found.shown > maxText) return;
      if (node.nodeType === 3) {
        const parent = node.parentElement;
        const visibility = parent ? styleOf(parent).visibility : 'hidden';
        if (visibility === 'hidden' || visibility === 'collapse') return;
        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects());
        if (!rects.length) return;
        const above = scrolled && rects.every((rect) => rect.bottom <= clipTop);
        if (above && found.above > maxText) return;
        const text = node.textContent || '';
        found[above ? 'above' : 'shown'] += clean(text, Infinity).length;
        all.push(text);
        (above ? aboveParts : shownParts).push(text);
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node as Element;
      if (UNREAD_TEXT.has(tagOf(el)) || hidesText(el)) return;
      if (found.above > maxText) {
        const box = el.getBoundingClientRect();
        if (box.height > 0 && box.bottom <= clipTop) {
          range.selectNodeContents(el);
          if (range.getBoundingClientRect().bottom <= clipTop) return;
        }
      }
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
   * A secret editor's text is never in it, nor, in a frame, any editor's.
   */
  const pageText = (d: Document, maxText: number): string => {
    if (maxText <= 0) return '';
    const full = fullText(d);
    const scrolled = scrolledAway(d);
    const secret = holdsHiddenText(d);
    if (!secret && (full.length <= maxText || !scrolled)) return cut(full, maxText);
    const { all, shown: inView, above } = textByView(d, maxText, scrolled);
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

  /* An element's parent as it is drawn: the slot it is assigned to, its
     parent, or a shadow root's host. */
  const drawnParent = (el: Element): Element | null =>
    el.assignedSlot ?? el.parentElement ?? ((el.getRootNode() as ShadowRoot).host ?? null);
  /* What an element draws reaches the person at this opacity or under, its
     own and its ancestors' multiplied, as the web pod's FAINT_OPACITY. */
  const FAINT_OPACITY = 0.1;
  /* The opacity a filter's opacity() functions draw with ("opacity(5%)"). */
  const filterOpacity = (filter: string): number => Array.from(filter.matchAll(/opacity\(\s*([\d.]+)(%?)\s*\)/g))
    .reduce((drawn, [, value, percent]) => drawn * Math.min(1, Number(value) / (percent ? 100 : 1)), 1);
  /* The functions a computed filter applies, in order, each by name ("blur",
     "url") with its argument's text, not the functions inside it (a drop
     shadow's color). */
  const filterFunctions = (filter: string): Array<{ name: string; arg: string }> => {
    const found: Array<{ name: string; arg: string }> = [];
    let depth = 0;
    let start = 0;
    for (const match of filter.matchAll(/([a-z-]*)\(|\)/g)) {
      if (match[0] === ')') {
        depth -= 1;
        if (depth === 0 && found.length) found[found.length - 1].arg = filter.slice(start, match.index).trim();
      } else if (depth++ === 0) {
        found.push({ name: match[1], arg: '' });
        start = (match.index ?? 0) + match[0].length;
      }
    }
    return found;
  };
  /* The properties that draw an element through a mask: an image, or a
     border image (one Chromium doesn't know reads as ''), as the web pod's
     MASKS. */
  const MASKS = ['mask-image', '-webkit-mask-image', '-webkit-mask-box-image-source', 'mask-border-source'];
  /* Filter functions that leave what an element draws readable however
     strong: they tint or shade it. opacity() counts toward FAINT_OPACITY. */
  const TINTS = new Set(['opacity', 'grayscale', 'sepia', 'saturate', 'hue-rotate', 'drop-shadow']);
  /* How brightness(), contrast() and invert() of an amount map a color
     channel's value, 0 to 1 (Chromium clamps what each draws to that range). */
  const CHANNEL_FILTERS: Record<string, (amount: number) => (value: number) => number> = {
    brightness: (amount) => (value) => amount * value,
    contrast: (amount) => (value) => amount * (value - 0.5) + 0.5,
    invert: (amount) => (value) => Math.min(amount, 1) + (1 - 2 * Math.min(amount, 1)) * value,
  };
  /* A filter's amount: a number or a percentage, 1 when left out. */
  const amountOf = (arg: string): number => {
    const match = /^([\d.]+(?:e-?\d+)?)(%?)$/.exec(arg || '1');
    return match ? Number(match[1]) / (match[2] ? 100 : 1) : NaN;
  };
  /* What filters may leave of a channel's range, black to white, for text
     drawn through them to stay readable, and how much they may blur it (in
     CSS pixels, every blur on the way together), as the web pod's
     READABLE_SPREAD and READABLE_BLUR_PX. */
  const READABLE_SPREAD = 0.5;
  const READABLE_BLUR_PX = 2;
  /* Whether `el`, though in view, draws so the person can't read it, as the
     web pod's isFaint and isObscured weigh it: it or an ancestor draws too
     faint (FAINT_OPACITY, its own opacity and its filter's opacity()
     functions, times each ancestor's), through a mask image or a mask border
     (MASKS), blended with what lies behind it, or through filters that, all
     together, in the order they draw, darken, brighten, invert or flatten it
     until less than READABLE_SPREAD of a channel's range is left (sample
     values run through each brightness(), contrast() and invert(), clamped),
     or blur it by more than READABLE_BLUR_PX. A tint or a shadow (TINTS)
     leaves it readable, so a dark mode, a slight dimming or a slight blur
     does; any other filter (an SVG one, by url()) counts as hiding it. */
  const drawnUnreadable = (el: Element): boolean => {
    let opacity = 1;
    let channel = [0, 0.25, 0.5, 0.75, 1];
    let blur = 0;
    for (let at: Element | null = el; at; at = drawnParent(at)) {
      const style = styleOf(at);
      const filter = style.filter || '';
      if (MASKS.some((name) => !['', 'none'].includes(style.getPropertyValue(name)))) return true;
      if (style.mixBlendMode && style.mixBlendMode !== 'normal') return true;
      for (const { name, arg } of filterFunctions(filter)) {
        if (TINTS.has(name)) continue;
        if (name === 'blur') {
          const radius = /^([\d.]+)px$/.exec(arg || '0px');
          if (!radius) return true;
          blur = Math.hypot(blur, Number(radius[1]));
          continue;
        }
        const amount = amountOf(arg);
        if (!CHANNEL_FILTERS[name] || !(amount >= 0)) return true;
        const map = CHANNEL_FILTERS[name](amount);
        channel = channel.map((value) => Math.min(1, Math.max(0, map(value))));
      }
      opacity *= Number(style.opacity || '1') * filterOpacity(filter);
    }
    return opacity <= FAINT_OPACITY || blur > READABLE_BLUR_PX || Math.max(...channel) - Math.min(...channel) < READABLE_SPREAD;
  };
  /* Under this share of its size either way, a frame is drawn too small to
     read, as the web pod's FRAME_MIN_SCALE. */
  const FRAME_MIN_SCALE = 0.5;
  /* The share of its laid-out size `el` is drawn at, the smaller of its
     width's and its height's, its transforms applied: 1 when it has no
     laid-out size to compare. */
  const drawnScale = (el: Element): number => {
    const { offsetWidth, offsetHeight } = el as HTMLElement;
    if (!(offsetWidth > 0) || !(offsetHeight > 0)) return 1;
    const box = boxOf(el);
    return Math.min(box.width / offsetWidth, box.height / offsetHeight);
  };
  /* A frame's hit test samples one point in each cell of a grid this many
     cells each way over its part in view, as the web pod's does. */
  const HIT_GRID = 5;
  /* Whether a hit test finds `owner` at most of its sample points over the
     part of its frame's content box `box` in view: one random point in each
     cell of a HIT_GRID by HIT_GRID grid, new at every read, so no fixed
     pattern of holes in a cover lets a hidden frame pass, while a banner
     across part of a frame leaves it seen. It stops once the answer is known.
     The world's hit test passes through an element marked pointer-events:
     none; ElectronTab.read's look at the frame's pixels finds a cover of one
     color there. */
  const hitsOwner = (owner: Element, box: Box): boolean => {
    const [left, top] = [Math.max(box.x, 0), Math.max(box.y, 0)];
    const [width, height] = [Math.min(box.x + box.width, viewport.width) - left, Math.min(box.y + box.height, viewport.height) - top];
    const cells = HIT_GRID * HIT_GRID;
    const need = Math.floor(cells / 2) + 1;
    let hits = 0;
    for (let cell = 0; cell < cells; cell += 1) {
      const x = left + (((cell % HIT_GRID) + Math.random()) * width) / HIT_GRID;
      const y = top + ((Math.floor(cell / HIT_GRID) + Math.random()) * height) / HIT_GRID;
      if (hitAt(Math.floor(x), Math.floor(y)) === owner) hits += 1;
      if (hits >= need) return true;
      if (hits + cells - cell - 1 < need) return false;
    }
    return false;
  };

  /* The frames among `owners` a click can land in, transparent ones
     included, on-screen first, each read when the rules let it: a
     same-origin frame the person sees (at least `minPx` each way, its part
     in view too, drawn at no less than FRAME_MIN_SCALE of its size, not
     drawn unreadable, and found by a hit test at most of its sample points,
     so a page can't carry a frame it hides off screen, under a box, behind
     its own CSS, or behind a cover with holes),
     within the first `candidates` frames read, on no payment, sign-in or
     consent address (its src's or its document's), and holding no private
     field. ElectronTab.read then looks at what the page draws over each
     frame read, and keeps the first `read` it finds seen (browser-view.ts). */
  const readFrames = (owners: Element[], rules: FrameReadRules): RawFrame[] => {
    const placed = owners
      .filter((owner) => takesClicks(owner, boxOf(owner)))
      .map((owner) => {
        const box = contentBox(owner);
        return { owner, box, offscreen: !inView(box) };
      });
    let reads = 0;
    return [...placed.filter((f) => !f.offscreen), ...placed.filter((f) => f.offscreen)].map(({ owner, box, offscreen }): RawFrame => {
      const inner = frameDocOf(owner);
      const src = sourceOf(owner);
      const url = inner ? String(inner.location?.href || src) : src;
      const refusedAddress = (address: string) =>
        hostIn(address, rules.paymentHosts) || hostIn(address, rules.signInHosts) || consentPage(address);
      const shownWidth = Math.min(box.x + box.width, viewport.width) - Math.max(box.x, 0);
      const shownHeight = Math.min(box.y + box.height, viewport.height) - Math.max(box.y, 0);
      if (!inner || offscreen || reads >= rules.candidates || Math.min(box.width, box.height, shownWidth, shownHeight) < rules.minPx
        || drawnScale(owner) < FRAME_MIN_SCALE || refusedAddress(src) || refusedAddress(url) || drawnUnreadable(owner)
        || !hitsOwner(owner, box) || holdsPrivateField(inner)) {
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

  /* Whether `el`, or an element it is drawn in, is turned, skewed or
     mirrored by a transform, so no box inside it maps through its box: a
     computed transform other than a matrix that only scales and moves it, a
     rotate, a scale that flips it, or an offset path, which turns it along
     the path (offset-rotate) while the other three stay none. */
  const turned = (el: Element): boolean => {
    for (let at: Element | null = el; at; at = drawnParent(at)) {
      const style = styleOf(at);
      const transform = style.transform || 'none';
      if (transform !== 'none') {
        const matrix = /^matrix\(([^)]*)\)$/.exec(transform);
        const [a, b, c, d] = matrix ? matrix[1].split(',').map(Number) : [NaN, NaN, NaN, NaN];
        if (!(a > 0 && d > 0 && b === 0 && c === 0)) return true;
      }
      if (!['', 'none'].includes(style.getPropertyValue('rotate'))) return true;
      if (!['', 'none'].includes(style.getPropertyValue('offset-path'))) return true;
      if (style.getPropertyValue('scale').split(/\s+/).some((value) => Number.parseFloat(value) < 0)) return true;
    }
    return false;
  };
  /* A computed -webkit-box-reflect: the edge of the element's border box it
     mirrors across, and how far beyond that edge the copy starts, in CSS
     pixels or as a percentage of the box's size that way. A mask image may
     follow, which only fades the copy. */
  const REFLECT = /^(above|below|left|right)\s+(-?[\d.]+(?:e[+-]?\d+)?)(px|%)(\s|$)/;
  /* Past this many copies of one box, a screenshot blacks out the whole
     view rather than each copy (a reflection inside a reflection doubles
     them). */
  const MAX_MIRRORS = 32;
  /* The view of the document `el` is in, in its own viewport's pixels. */
  const wholeView = (el: Element): Box => {
    const view = el.ownerDocument.defaultView ?? win;
    return { x: 0, y: 0, width: view.innerWidth, height: view.innerHeight };
  };
  /* The copies -webkit-box-reflect draws of `box`, a box drawn inside `el`
     (both in its document's viewport): one for `el`'s own reflection and for
     each element it is drawn in that reflects, a copy of a copy included,
     each mirrored across the reflecting element's border box edge, its
     offset beyond it scaled as the element is drawn (its box over its
     laid-out size). A reflection whose offset this can't read, one a
     transform or an offset path turns (turned), which mirrors across a line
     no box maps through, or more than MAX_MIRRORS copies, give the whole
     view instead. */
  const mirrored = (el: Element, box: Box): Box[] => {
    let boxes = [box];
    for (let at: Element | null = el; at; at = drawnParent(at)) {
      const reflect = styleOf(at).getPropertyValue('-webkit-box-reflect');
      if (['', 'none'].includes(reflect)) continue;
      const parsed = REFLECT.exec(reflect);
      if (!parsed || turned(at)) return [wholeView(el)];
      const [, side, amount, unit] = parsed;
      const edge = boxOf(at);
      const across = side === 'left' || side === 'right';
      const drawn = across ? edge.width : edge.height;
      const laid = across ? (at as HTMLElement).offsetWidth : (at as HTMLElement).offsetHeight;
      const offset = unit === '%' ? (Number(amount) / 100) * drawn : Number(amount) * (laid > 0 ? drawn / laid : 1);
      /* The mirror line, twice over: a copy's near edge is that minus the
         original's far edge. */
      const line = {
        above: 2 * edge.y - offset,
        below: 2 * (edge.y + edge.height) + offset,
        left: 2 * edge.x - offset,
        right: 2 * (edge.x + edge.width) + offset,
      }[side as 'above' | 'below' | 'left' | 'right'];
      boxes = [...boxes, ...boxes.map((b) => (across
        ? { ...b, x: line - b.x - b.width }
        : { ...b, y: line - b.y - b.height }))];
      if (boxes.length - 1 > MAX_MIRRORS) return [wholeView(el)];
    }
    return boxes.slice(1);
  };
  /* How a box in same-origin frame `owner`'s own viewport lands in its
     document's viewport: scaled as the frame is drawn (its box over its
     laid-out size, so a transform that scales it scales the box),
     from the corner of its content box; for a frame a transform or an
     offset path turns, the frame's whole box. */
  const throughOwner = (owner: Element): ((box: Box) => Box) => {
    const box = boxOf(owner);
    if (turned(owner)) return () => box;
    const { offsetWidth, offsetHeight } = owner as HTMLElement;
    const sx = offsetWidth > 0 ? box.width / offsetWidth : 1;
    const sy = offsetHeight > 0 ? box.height / offsetHeight : 1;
    const style = styleOf(owner);
    const px = (value: string) => parseFloat(value) || 0;
    const x = box.x + (px(style.borderLeftWidth) + px(style.paddingLeft)) * sx;
    const y = box.y + (px(style.borderTopWidth) + px(style.paddingTop)) * sy;
    return (inner) => ({ x: x + inner.x * sx, y: y + inner.y * sy, width: inner.width * sx, height: inner.height * sy });
  };

  /* What a screenshot must not show. Same-origin frames are searched in
     turn, `maxDepth` deep, each box placed where the frame draws it
     (throughOwner); a frame from another site can't be, and one past that
     depth isn't. A secret field's copies that -webkit-box-reflect draws
     (mirrored) are secrets too, and so is every frame's copy, whole: a read
     of a frame's fields, here or in the frame's own world
     (browser-frames.ts), places them in the frame alone. */
  const secretBoxes = (paymentHosts: readonly string[], maxDepth: number): FoundSecrets => {
    const found: FoundSecrets = { secrets: [], paymentFrames: [], otherSiteFrames: [], mirroredFrames: [], owners: 0, viewport };
    const visit = (root: Node, place: (box: Box) => Box, depth: number) => {
      const add = (into: Box[], el: Element) => {
        const box = boxOf(el);
        if (box.width > 0 && box.height > 0) into.push(place(box));
      };
      const addMirrored = (into: Box[], el: Element) => {
        const box = boxOf(el);
        if (box.width > 0 && box.height > 0) into.push(...mirrored(el, box).map(place));
      };
      for (const el of elementsIn(root)) {
        if (!FRAME_TAGS.has(tagOf(el))) {
          if (isField(el) && isSecret(el)) {
            add(found.secrets, el);
            addMirrored(found.secrets, el);
          }
          continue;
        }
        addMirrored(found.mirroredFrames, el);
        if (holdsFrame(el)) found.owners += 1;
        const inner = frameDocOf(el);
        const payment = hostIn(sourceOf(el), paymentHosts) || (!!inner && hostIn(String(inner.location?.href || ''), paymentHosts));
        if (payment) add(found.paymentFrames, el);
        if (!inner || depth >= maxDepth) add(found.otherSiteFrames, el);
        else if (!payment) {
          const into = throughOwner(el);
          visit(inner, (box) => place(into(box)), depth + 1);
        }
      }
    };
    visit(doc, (box) => box, 0);
    return found;
  };

  /* The focused element, from the document or the root the request starts
     at (`from`), followed into open shadow roots and same-origin frames. A
     frame from another site keeps the focus on its owner, and a closed
     shadow root on its host. */
  const deepActive = (): Element | null => {
    let active = (from ?? doc).activeElement;
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

  /* The elements besides custom ones a page may attach a shadow root to. */
  const SHADOW_HOSTS = new Set(['article', 'aside', 'blockquote', 'body', 'div', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'main', 'nav', 'p', 'section', 'span']);
  /* Whether the page's DOM has fewer frame owners that hold a frame than the
     main frame's `childFrames`: one sits where this world can't place it, a
     closed shadow root among them. */
  const framesHidden = (childFrames: number): boolean =>
    elementsIn(doc).filter((el) => FRAME_TAGS.has(tagOf(el)) && holdsFrame(el)).length < childFrames;
  /* Whether a click on `hit` at (x, y) lands where this world can't see: in
     a frame owner's document, or in an element that shows no open shadow
     root and has no text of its own there, whose closed shadow root may hold
     a frame. That is any custom element, and any other element a page may
     attach a shadow root to while the page holds a frame its DOM can't place
     (`hidden`, asked only when needed). */
  const opaqueHit = (hit: Element, x: number, y: number, hidden: () => boolean): boolean => {
    if (FRAME_TAGS.has(tagOf(hit))) return true;
    const host = tagOf(hit).includes('-') || SHADOW_HOSTS.has(tagOf(hit));
    if (!host || hit.shadowRoot || ownTextAt(hit, x, y)) return false;
    return tagOf(hit).includes('-') || hidden();
  };
  /* `framesHidden`, worked out once per request. */
  const hiddenOnce = (childFrames: number): (() => boolean) => {
    let hidden: boolean | null = null;
    return () => (hidden ??= framesHidden(childFrames));
  };

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

  /* The frame owner the focus rests on when this world can't read its
     frame, or null. */
  const focusedFrameOwner = (): Element | null => {
    const active = deepActive();
    return active && FRAME_TAGS.has(tagOf(active)) && !frameDocOf(active) ? active : null;
  };

  /* Whether the focus rests on an element that may keep a closed shadow
     root, where the focus may sit on a field this world can't see: one that
     shows no open shadow root and that a page may attach one to (a custom
     element, or one of SHADOW_HOSTS, the body included). */
  const focusSealed = (): boolean => {
    const active = deepActive();
    return !!active && !active.shadowRoot && (tagOf(active).includes('-') || SHADOW_HOSTS.has(tagOf(active)));
  };

  /* The text entry a type with focused true types into, or null: the
     focused element, followed as deepActive follows it and on into a
     same-origin frame whose body has the focus there (a whole-document
     editor), when it is a text, search, email, url, tel or number input, a
     textarea, or an editor, and isn't secret. */
  const focusedEntry = (): Element | null => {
    const active = deepActive();
    const inner = active && FRAME_TAGS.has(tagOf(active)) ? frameDocOf(active) : null;
    const at = inner?.body && inner.activeElement === inner.body ? inner.body : active;
    if (!at || isSecret(at)) return null;
    if (tagOf(at) === 'input') return TEXT_ENTRY_INPUTS.has((at as HTMLInputElement).type) ? at : null;
    if (tagOf(at) === 'textarea') return at;
    return editable(at) || contentEditable(at) || userModifiable(at) ? at : null;
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
      return { secret: focusOnSecret(), otherSite: !!focusedFrameOwner(), sealed: focusSealed() } satisfies FocusedSecret;
    case 'focusedFrame':
      return focusedFrameOwner();
    case 'focusedElement':
      return deepActive();
    case 'focusedEntry':
      return focusedEntry();
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
      const hidden = hiddenOnce(request.childFrames);
      const landings = request.points.map(({ x, y }) => {
        const hit = hitAt(x, y);
        if (!hit || !landsOn(el, hit)) return 'elsewhere';
        return opaqueHit(hit, x, y, hidden) ? 'frame' : 'element';
      });
      return { found: true, reaches: landings.indexOf('element'), throughFrame: landings.indexOf('frame') } satisfies HitTestResult;
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
      return secretBoxes(request.paymentHosts, request.depth);
    case 'watch':
      world.observer ??= new MutationObserver(onMutations);
      watchRoot(doc);
      markSecrets(doc);
      return { ok: true };
  }
}

/** The longest frame address a page answer carries. */
const MAX_FRAME_ADDRESS = 1024;

/** A frame's address as a page answer gives it (page.json): origin and path
    for http and https, about:blank or about:srcdoc, otherwise the scheme
    alone, and '' for one that doesn't parse. An owner with no src (an empty
    address) shows about:blank. */
export function frameAddress(address: string): string {
  if (!address) return 'about:blank';
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return '';
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return `${url.origin}${url.pathname}`.slice(0, MAX_FRAME_ADDRESS);
  if (url.protocol === 'about:' && (url.pathname === 'blank' || url.pathname === 'srcdoc')) return `about:${url.pathname}`;
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

/** What a screenshot blacks out: secret fields, payment frames and the
    frames' copies a reflection draws, and every
    frame the search didn't enter when the frame tree (`frameUrls`) holds a
    payment frame the page's DOM doesn't account for (one nested in another
    site's frame, or one that navigated there). Null, for no screenshot at
    all, when the frame tree holds a payment frame and the frames it places
    in the searched documents (`searchedFrames`) don't number the owners the
    search found: one sits where the DOM can't place it (a closed shadow
    root, behind an embed), so no box would cover it. */
export function screenshotMasks(found: FoundSecrets, frameUrls: string[], searchedFrames: number): Box[] | null {
  const payments = frameUrls.filter(isPaymentAddress).length;
  if (payments > 0 && found.owners !== searchedFrames) return null;
  const unaccounted = payments > found.paymentFrames.length;
  return [...found.secrets, ...found.paymentFrames, ...found.mirroredFrames, ...(unaccounted ? found.otherSiteFrames : [])];
}

/* The isolated world's own global holds the state between reads. That global
   belongs to the isolated world, not to the page, so the page never sees it. */
const WORLD_STATE_KEY = '__coworkBrowserWorld';

const WORLD_STATE = `globalThis[${JSON.stringify(WORLD_STATE_KEY)}] ??= { ids: new Map(), byElement: new WeakMap(), next: 1, secret: new WeakSet(), observer: null, watched: new WeakSet(), change: null }`;

/** The source text that runs `request` in the isolated world. */
export function pageWorldSource(request: PageWorldRequest): string {
  return `(${pageWorld.toString()})(document, ${WORLD_STATE}, ${JSON.stringify(request)})`;
}

/** The source text of a function that runs `request` in the isolated world
    from the node the debugger passes it (Runtime.callFunctionOn): a closed
    shadow root to read the focus inside (pageWorld's `from`). */
export function pageWorldFunction(request: PageWorldRequest): string {
  return `function (from) { return (${pageWorld.toString()})(document, ${WORLD_STATE}, ${JSON.stringify(request)}, from); }`;
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
