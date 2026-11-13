// @vitest-environment happy-dom
import { readFileSync } from 'fs';
import path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_FIELD_ATTRIBUTES, ELEMENTS_PER_FRAME, TEXT_PER_FRAME } from '../shared/browser-contract';
import { type FixtureFile, pageShape, problems } from '../../tests/browser-contract-shapes';
import {
  CARD_FIELD_RULE,
  type FoundSecrets,
  FRAME_READ_RULES,
  frameAddress,
  isPaymentAddress,
  type RawFrame,
  screenshotMasks,
  challengeKind,
  challengesFrom,
  type FocusFieldResult,
  type ChangeMark,
  type FocusedSecret,
  type FocusedTyping,
  type FocusResult,
  type HitTestResult,
  type LocateResult,
  pageAnswer,
  pageWorld,
  pageWorldFunction,
  pageWorldSource,
  type PageWorldState,
  type RawSnapshot,
  SECRET_SEARCH_DEPTH,
  type SelectResult,
  type TypingFocus,
} from './browser-page-script';

/* happy-dom has no layout, so each test places the elements it needs. The box
   is an own property on the element object, not an attribute, so it is not a
   DOM change the observers below would see. */
function place(el: Element, x: number, y: number, width: number, height: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: x, top: y, x, y, width, height, right: x + width, bottom: y + height }),
  });
}

function layout(): void {
  let y = 10;
  for (const el of Array.from(document.querySelectorAll('[data-box]'))) {
    const [w, h] = (el.getAttribute('data-box') || '100x20').split('x').map(Number);
    place(el, 10, y, w, h);
    y += h + 10;
  }
}

const freshWorld = (): PageWorldState => ({
  cardField: CARD_FIELD_RULE, ids: new Map(), byElement: new WeakMap(), next: 1, secret: new WeakSet(), observer: null, watched: new WeakSet(), change: null,
});

/* MutationObserver callbacks run after the change, as in a browser. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/* A world whose secret-field watch runs, stopped after each test. */
const watching: PageWorldState[] = [];
function watchedWorld(): PageWorldState {
  const world = freshWorld();
  pageWorld(document, world, { kind: 'watch' });
  watching.push(world);
  return world;
}

function snapshot(world: PageWorldState, maxText = 3000, maxElements = 300): RawSnapshot {
  return pageWorld(document, world, { kind: 'snapshot', maxText, maxElements, frames: FRAME_READ_RULES }) as RawSnapshot;
}

/* A srcdoc frame's document loads after it is attached. */
const framesLoad = () => new Promise((resolve) => setTimeout(resolve, 30));
const frameDoc = (id: string): Document => (document.getElementById(id) as HTMLIFrameElement).contentDocument!;

/* What a screenshot of this page must hide, the search `depth` documents deep. */
const secretBoxes = (depth = SECRET_SEARCH_DEPTH): FoundSecrets =>
  pageWorld(document, freshWorld(), { kind: 'secretBoxes', paymentHosts: [...FRAME_READ_RULES.paymentHosts], depth }) as FoundSecrets;

/* The frames a read listed, by address. */
const framesByUrl = (page: RawSnapshot): Record<string, RawFrame> => Object.fromEntries(page.frames.map((f) => [f.url, f]));

/* happy-dom gives a text node no boxes, so each text node here takes its
   parent element's box, as Chromium gives a line of text its own: in this
   document, or in a frame's. A range over an element's contents is bounded
   by every placed box in it. `reads()` counts the text nodes' box reads. */
function textBoxesFromParents(doc: Document = document): (() => void) & { reads: () => number } {
  const original = doc.createRange;
  let reads = 0;
  const placedBox = (el: Element | null) => {
    const box = el?.getBoundingClientRect();
    return box && (box.width || box.height) ? box : null;
  };
  doc.createRange = () => {
    let node: Node | null = null;
    return {
      selectNodeContents: (target: Node) => { node = target; },
      getClientRects: () => {
        reads += 1;
        const box = placedBox(node?.parentElement ?? null);
        return box ? [box] : [];
      },
      getBoundingClientRect: () => {
        const boxes = [node as Element, ...Array.from((node as Element).querySelectorAll('*'))].map(placedBox).filter((box) => box !== null);
        const top = Math.min(...boxes.map((box) => box.top));
        const bottom = Math.max(...boxes.map((box) => box.bottom));
        return boxes.length ? { top, bottom, height: bottom - top } : { top: 0, bottom: 0, height: 0 };
      },
    } as unknown as Range;
  };
  return Object.assign(() => { doc.createRange = original; }, { reads: () => reads });
}

/* happy-dom has no hit test, so each test says what lies at each point. */
function hitTestBy(at: (x: number, y: number) => Element | null): () => void {
  const original = document.elementFromPoint;
  document.elementFromPoint = at;
  return () => { document.elementFromPoint = original; };
}

/* A hit test by the boxes a test places: the last frame owner in page order
   whose box holds the point, or the host of an open shadow root that holds
   one there, whose shadow root then answers its own hit test. */
function hitTestByBoxes(): () => void {
  const hitIn = (root: Document | ShadowRoot) => (x: number, y: number): Element | null => {
    const holds = (el: Element) => {
      const box = el.getBoundingClientRect();
      return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
    };
    const hits = Array.from(root.querySelectorAll('*')).filter((el) =>
      (['iframe', 'frame', 'object', 'embed'].includes(el.localName) && holds(el)) || (!!el.shadowRoot && !!hitIn(el.shadowRoot)(x, y)));
    const hit = hits.at(-1) ?? null;
    if (hit?.shadowRoot) Object.defineProperty(hit.shadowRoot, 'elementFromPoint', { configurable: true, value: hitIn(hit.shadowRoot) });
    return hit;
  };
  return hitTestBy(hitIn(document));
}

const SIGN_IN = `
  <h1>Sign in to Example Shop</h1>
  <input data-box type="search" aria-label="Search">
  <label for="email">Email</label><input data-box id="email" type="email" value="ada@example.test">
  <label>Password <input data-box id="pw" type="password" value="hunter2"></label>
  <input data-box id="otp" autocomplete="one-time-code" placeholder="One-time code" value="123456">
  <input data-box id="card" autocomplete="cc-number" placeholder="Card number" value="4111111111111111">
  <input data-box id="newpw" autocomplete="new-password" placeholder="New password" value="s3cret">
  <label><input data-box type="checkbox" id="keep"> Keep me signed in</label>
  <label>Country <select data-box id="country"><option value="mx">Mexico</option><option value="ca">Canada</option></select></label>
  <button data-box id="go">Sign in</button>
  <button data-box disabled>Create account</button>
  <a data-box href="/forgot">Forgot password?</a>
  <input type="hidden" name="csrf" value="secret-token">
  <div style="display:none"><button>Hidden</button></div>
`;

/* Frames in these pages must never load their addresses for real. */
const happyDom = () => (window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM;
let iframeLoading = false;
beforeAll(() => {
  iframeLoading = happyDom().settings.disableIframePageLoading;
  happyDom().settings.disableIframePageLoading = true;
});
afterAll(() => {
  happyDom().settings.disableIframePageLoading = iframeLoading;
});

afterEach(() => {
  for (const world of watching.splice(0)) {
    world.observer?.disconnect();
    if (world.change) pageWorld(document, world, { kind: 'changeStop', token: world.change.token });
  }
  document.body.innerHTML = '';
});

describe('the isolated-world page read', () => {
  it('numbers the elements and hides every secret value', () => {
    document.body.innerHTML = SIGN_IN;
    layout();
    const page = snapshot(freshWorld());
    const byName = Object.fromEntries(page.elements.map((e) => [e.name, e]));
    expect(byName.Search).toMatchObject({ role: 'searchbox' });
    expect(byName.Email).toMatchObject({ role: 'textbox', value: 'ada@example.test' });
    expect(byName.Password).toEqual({ id: byName.Password.id, role: 'textbox', name: 'Password', type: 'password', value_hidden: true });
    for (const name of ['One-time code', 'Card number', 'New password']) {
      expect(byName[name], name).toMatchObject({ value_hidden: true });
      expect(byName[name], name).not.toHaveProperty('value');
    }
    expect(byName['Keep me signed in']).toMatchObject({ role: 'checkbox', checked: false });
    expect(byName.Country).toMatchObject({ role: 'combobox', value: 'Mexico', options: ['Mexico', 'Canada'] });
    expect(byName['Create account']).toMatchObject({ role: 'button', disabled: true });
    expect(byName['Forgot password?']).toMatchObject({ role: 'link' });
    expect(page.elements.map((e) => e.name)).not.toContain('Hidden');
    expect(JSON.stringify(page)).not.toMatch(/hunter2|123456|4111111111111111|s3cret|secret-token/);
  });

  it("answers in the shape anton reads, with a check frame the person sees", () => {
    document.body.innerHTML = `${SIGN_IN}<iframe data-box="300x65" title="Widget containing a Cloudflare security challenge" src="https://challenges.cloudflare.com/cdn-cgi/x"></iframe>`;
    layout();
    const raw = snapshot(freshWorld());
    const frameUrls = ['https://challenges.cloudflare.com/cdn-cgi/x'];
    const answer = pageAnswer(raw, challengesFrom(frameUrls, raw.frameOwners), frameUrls, []);
    expect(problems(pageShape, answer)).toEqual([]);
    expect(answer.challenges).toEqual([{ host: 'challenges.cloudflare.com', kind: 'cloudflare' }]);
    expect(answer.frames).toEqual([{ url: 'https://challenges.cloudflare.com/cdn-cgi/x', read: false, box: { x: 10, y: 340, width: 300, height: 65 }, at: { x: 10, y: 340 } }]);
    expect(answer).not.toHaveProperty('boxes');
    expect(answer).not.toHaveProperty('frameOwners');
    expect(pageWorld(document, freshWorld(), { kind: 'viewport' })).toEqual({ width: window.innerWidth, height: window.innerHeight });
  });

  it('keeps a field hidden after it stops being a password field', () => {
    document.body.innerHTML = '<input data-box id="pw" type="password" aria-label="Password" value="hunter2">';
    layout();
    const world = freshWorld();
    snapshot(world);
    const field = document.getElementById('pw') as HTMLInputElement;
    field.type = 'text';
    const page = snapshot(world);
    expect(page.elements[0]).toMatchObject({ name: 'Password', value_hidden: true });
    expect(JSON.stringify(page)).not.toContain('hunter2');
  });

  it('reads an ordinary field up to 200 characters', () => {
    document.body.innerHTML = `<textarea data-box aria-label="Note">${'n'.repeat(450)}</textarea><div data-box contenteditable aria-label="Editor">${'e'.repeat(450)}</div>`;
    layout();
    const [note, editor] = snapshot(freshWorld()).elements;
    expect(note.value).toHaveLength(200);
    expect(editor.value).toHaveLength(200);
  });

  it('keeps a field hidden that turned from a password into text before any read', async () => {
    document.body.innerHTML = '<input data-box id="pw" type="password" aria-label="Password" value="hunter2">';
    layout();
    const world = watchedWorld();
    (document.getElementById('pw') as HTMLInputElement).type = 'text';
    await settle();
    const page = snapshot(world);
    expect(page.elements[0]).toMatchObject({ name: 'Password', value_hidden: true });
    expect(JSON.stringify(page)).not.toContain('hunter2');
  });

  it('keeps a field hidden that dropped its one-time-code autocomplete before any read', async () => {
    document.body.innerHTML = '<input data-box id="otp" autocomplete="one-time-code" aria-label="Code" value="123456">';
    layout();
    const world = watchedWorld();
    document.getElementById('otp')!.removeAttribute('autocomplete');
    await settle();
    expect(snapshot(world).elements[0]).toMatchObject({ name: 'Code', value_hidden: true });
  });

  it('keeps hidden a password field the page adds later and then shows, in an open shadow root too', async () => {
    document.body.innerHTML = '<div id="form"></div>';
    const world = watchedWorld();
    // The second step of a sign-in renders during the person's turn.
    document.getElementById('form')!.innerHTML = '<label>Password <input data-box id="pw" type="password" value="hunter2"></label>';
    const widget = document.createElement('div');
    const root = widget.attachShadow({ mode: 'open' });
    root.innerHTML = '<input id="pin" type="password" aria-label="PIN" value="4321">';
    document.body.append(widget);
    await settle();
    (document.getElementById('pw') as HTMLInputElement).type = 'text';
    (root.getElementById('pin') as HTMLInputElement).type = 'text';
    await settle();
    layout();
    place(root.getElementById('pin')!, 10, 200, 100, 20);
    const page = snapshot(world);
    expect(page.elements.map((e) => e.value_hidden)).toEqual([true, true]);
    expect(JSON.stringify(page)).not.toMatch(/hunter2|4321/);
  });

  it('keeps hidden a password field rendered later into an open shadow root that was there before the watch, and then shown', async () => {
    const widget = document.createElement('div');
    const root = widget.attachShadow({ mode: 'open' });
    document.body.append(widget);
    const world = watchedWorld();
    // The component renders its password step into its existing root.
    root.innerHTML = '<input id="pw" type="password" aria-label="Password" value="hunter2">';
    await settle();
    (root.getElementById('pw') as HTMLInputElement).type = 'text';
    await settle();
    place(root.getElementById('pw')!, 10, 10, 100, 20);
    const page = snapshot(world);
    expect(page.elements).toEqual([expect.objectContaining({ name: 'Password', value_hidden: true })]);
    expect(JSON.stringify(page)).not.toContain('hunter2');
  });

  it('marks a secret field that arrives inside an element with an open shadow root', async () => {
    document.body.innerHTML = '';
    const world = watchedWorld();
    const widget = document.createElement('div');
    widget.attachShadow({ mode: 'open' }).innerHTML = '<input id="pin" type="password">';
    document.body.append(widget);
    await settle();
    expect(world.secret.has(widget.shadowRoot!.getElementById('pin')!)).toBe(true);
  });

  it('starts one watch per document however often it is asked', () => {
    document.body.innerHTML = '<input id="pw" type="password">';
    const world = watchedWorld();
    const observer = world.observer;
    expect(pageWorld(document, world, { kind: 'watch' })).toEqual({ ok: true });
    expect(world.observer).toBe(observer);
    expect(world.secret.has(document.getElementById('pw')!)).toBe(true);
  });

  it('keeps ids stable within a document and never reuses them', () => {
    document.body.innerHTML = SIGN_IN;
    layout();
    const world = freshWorld();
    const first = snapshot(world);
    const go = first.elements.find((e) => e.name === 'Sign in')!;
    document.getElementById('country')!.remove();
    const button = document.createElement('button');
    button.textContent = 'Later';
    document.body.prepend(button);
    place(button, 10, 1, 50, 20);
    const second = snapshot(world);
    expect(second.elements.find((e) => e.name === 'Sign in')!.id).toBe(go.id);
    const later = second.elements.find((e) => e.name === 'Later')!;
    expect(later.id).toBeGreaterThan(Math.max(...first.elements.map((e) => e.id)));
    expect(second.elements.find((e) => e.name === 'Country')).toBeUndefined();
  });

  it('writes nothing into the DOM and adds no page globals', () => {
    document.body.innerHTML = SIGN_IN;
    layout();
    const before = new Set(Object.getOwnPropertyNames(window));
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(document, { attributes: true, childList: true, subtree: true, characterData: true });
    const world = freshWorld();
    pageWorld(document, world, { kind: 'watch' });
    snapshot(world);
    snapshot(world);
    pageWorld(document, world, { kind: 'locate', id: 1, reveal: false });
    pageWorld(document, world, { kind: 'focusedSecret' });
    pageWorld(document, world, { kind: 'typingFocus', id: 1 });
    pageWorld(document, world, { kind: 'changeStart', token: 1 });
    pageWorld(document, world, { kind: 'changeMark', token: 1, at: { x: 5, y: 5 } });
    pageWorld(document, world, { kind: 'changeStop', token: 1 });
    world.observer?.disconnect();
    changes.push(...observer.takeRecords());
    observer.disconnect();
    expect(changes).toEqual([]);
    expect(Object.getOwnPropertyNames(window).filter((name) => !before.has(name))).toEqual([]);
  });

  it('marks elements outside the viewport and labels only those inside it', () => {
    document.body.innerHTML = '<button id="a">In view</button><button id="b">Below</button>';
    place(document.getElementById('a')!, 10, 10, 80, 20);
    place(document.getElementById('b')!, 10, window.innerHeight + 200, 80, 20);
    const page = snapshot(freshWorld());
    expect(page.elements).toEqual([
      { id: 1, role: 'button', name: 'In view' },
      { id: 2, role: 'button', name: 'Below', offscreen: true },
    ]);
    expect(page.boxes).toEqual([{ id: 1, x: 10, y: 10, width: 80, height: 20 }]);
  });

  it('reads elements inside an open shadow root', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<button>Inside</button>';
    place(root.querySelector('button')!, 10, 10, 50, 20);
    expect(snapshot(freshWorld()).elements.map((e) => e.name)).toEqual(['Inside']);
  });

  it('cuts the text at max_text, and truncated says only that more elements exist than are listed', () => {
    document.body.innerHTML = `<p>${'word '.repeat(100)}</p><button data-box>One</button><button data-box>Two</button><button data-box>Three</button>`;
    layout();
    const cut = snapshot(freshWorld(), 50);
    expect(cut.text).toHaveLength(50);
    expect(cut.truncated).toBe(false);
    const capped = snapshot(freshWorld(), 3000, 2);
    expect(capped.elements.map((e) => e.name)).toEqual(['One', 'Two']);
    expect(capped.truncated).toBe(true);
  });

  it('answers no text for max_text 0', () => {
    document.body.innerHTML = `<p>${'word '.repeat(100)}</p>`;
    expect(snapshot(freshWorld(), 0).text).toBe('');
  });

  it('lists no frame as an element, an object or an embed that names itself a control included, and records every frame owner and whether it shows, for the checks', () => {
    document.body.innerHTML = `
      <iframe id="cf" title="Widget containing a Cloudflare security challenge" src="https://challenges.cloudflare.com/cdn-cgi/x"></iframe>
      <iframe id="rc" src="https://www.google.com/recaptcha/api2/anchor?k=x"></iframe>
      <iframe id="tab" tabindex="0" onclick="go()" src="https://ads.example.test/"></iframe>
      <object id="obj" data="https://shop.other.test/buy" type="text/html" role="button" aria-label="Dismiss"></object>
      <embed id="emb" src="https://shop.other.test/buy" type="text/html" tabindex="0" title="Close">`;
    place(document.getElementById('cf')!, 10, 10, 300, 65);
    place(document.getElementById('rc')!, 0, 0, 0, 0);
    place(document.getElementById('tab')!, 10, 100, 300, 250);
    place(document.getElementById('obj')!, 10, 360, 300, 100);
    place(document.getElementById('emb')!, 10, 470, 300, 100);
    const world = freshWorld();
    const page = snapshot(world);
    expect(page.frameOwners).toEqual([
      { url: 'https://challenges.cloudflare.com/cdn-cgi/x', visible: true, framed: true },
      { url: 'https://www.google.com/recaptcha/api2/anchor?k=x', visible: false, framed: true },
      { url: 'https://ads.example.test/', visible: true, framed: true },
      { url: 'https://shop.other.test/buy', visible: true, framed: false },
      { url: 'https://shop.other.test/buy', visible: true, framed: false },
    ]);
    expect(page.elements).toEqual([]);
    expect(page.boxes).toEqual([]);
    expect(world.ids.size).toBe(0);
  });

  it('keeps the focus on an embed or an object it may not read into, so an editing key there counts as one into another site', () => {
    document.body.innerHTML = '<embed id="emb" src="https://shop.other.test/buy" type="text/html" tabindex="0"><object id="obj" data="https://shop.other.test/buy" type="text/html" tabindex="0"></object>';
    const world = freshWorld();
    for (const id of ['emb', 'obj']) {
      (document.getElementById(id) as HTMLElement).focus();
      expect(pageWorld(document, world, { kind: 'focusedSecret' }), id).toEqual({ secret: false, otherSite: true, sealed: false } satisfies FocusedSecret);
    }
  });

  it('past the cap, lists the elements in view first, each group in page order, and numbers only those it lists', () => {
    document.body.innerHTML = Array.from({ length: 6 }, (_, i) => `<button id="b${i + 1}">Button ${i + 1}</button>`).join('');
    // Buttons 1 to 3 sit above the view, scrolled past; 4 to 6 are in it.
    for (let i = 1; i <= 6; i += 1) place(document.getElementById(`b${i}`)!, 10, i <= 3 ? -400 + i * 30 : (i - 4) * 30 + 10, 80, 20);
    const world = freshWorld();
    const capped = snapshot(world, 3000, 4);
    expect(capped.elements.map((e) => [e.name, e.offscreen ?? false])).toEqual([
      ['Button 4', false], ['Button 5', false], ['Button 6', false], ['Button 1', true],
    ]);
    expect(capped.truncated).toBe(true);
    expect(world.byElement.has(document.getElementById('b2')!)).toBe(false);
    expect(world.byElement.has(document.getElementById('b3')!)).toBe(false);
    // Everything fits: page order, as before, so a scroll alone never reorders the list.
    const all = snapshot(world, 3000, 6);
    expect(all.elements.map((e) => e.name)).toEqual(['Button 1', 'Button 2', 'Button 3', 'Button 4', 'Button 5', 'Button 6']);
    expect(all.truncated).toBe(false);
  });

  it("keeps a secret editor's text out of the page text and every name", () => {
    const CARD = '4242 4242 4242 4242';
    const editor = (id: string) => `<div data-box id="${id}" contenteditable autocomplete="cc-number">${CARD}</div>`;
    document.body.innerHTML = `
      ${editor('bare')}
      <div data-box tabindex="0">Pay with ${editor('wrapped')}</div>
      <label>Saved card ${editor('labelled')} <input data-box type="checkbox"></label>
      <button data-box aria-labelledby="named">x</button>${editor('named')}
      <p data-box>Total: $12.00</p>`;
    layout();
    const restore = textBoxesFromParents();
    try {
      window.scrollTo(0, 0);
      const page = snapshot(freshWorld());
      expect(page.text).toContain('Total: $12.00');
      expect(JSON.stringify(page)).not.toContain('4242');
      expect(page.elements.find((e) => e.role === 'checkbox')).toMatchObject({ name: 'Saved card' });
    } finally {
      restore();
    }
  });

  describe('the page text', () => {
    /* 40 paragraphs of 100 characters, 30 px apart, with the view scrolled
       to `scrollY`: paragraph N sits at (N - 1) * 30 - scrollY. */
    function longPage(scrollY: number): () => void {
      document.body.innerHTML = Array.from({ length: 40 }, (_, i) => `<p>${`Paragraph ${i + 1} `.padEnd(100, 'x')}</p>`).join('');
      document.querySelectorAll('p').forEach((p, i) => place(p, 0, i * 30 - scrollY, 600, 20));
      window.scrollTo(0, scrollY);
      return textBoxesFromParents();
    }

    afterEach(() => window.scrollTo(0, 0));

    it('starts at the top of the view once the page is scrolled past what fits, then the start of the page', () => {
      const restore = longPage(900);
      try {
        const text = snapshot(freshWorld(), 3000).text;
        expect(text.startsWith('… Paragraph 31 x')).toBe(true);
        expect(text).toContain('Paragraph 40 x');
        expect(text).toContain(' … (above the view) Paragraph 1 x');
        expect(text.length).toBeLessThanOrEqual(3000);
        // A budget the view alone fills gets no text from above it.
        const short = snapshot(freshWorld(), 500).text;
        expect(short.startsWith('… Paragraph 31 x')).toBe(true);
        expect(short).not.toContain('above the view');
        expect(short).toHaveLength(500);
      } finally {
        restore();
      }
    });

    it('reads only as far as a read can show on a long scrolled page, and answers the same', () => {
      // 2,000 paragraphs of 100 characters, 30 px apart.
      document.body.innerHTML = Array.from({ length: 2_000 }, (_, i) => `<p>${`Paragraph ${i + 1} `.padEnd(100, 'x')}</p>`).join('');
      const scrolledTo = (y: number) => {
        document.querySelectorAll('p').forEach((p, i) => place(p, 0, i * 30 - y, 600, 20));
        window.scrollTo(0, y);
      };
      const restore = textBoxesFromParents();
      try {
        // In the middle: the text from the view on fills the read.
        scrolledTo(30_000);
        const middle = snapshot(freshWorld(), 3000).text;
        expect(middle.startsWith('… Paragraph 1001 x')).toBe(true);
        expect(middle).toContain('Paragraph 1010 x');
        expect(middle).toHaveLength(3000);
        // Near the end: the text from the view on, then the start of the page.
        scrolledTo(59_400);
        const end = snapshot(freshWorld(), 3000).text;
        expect(end.startsWith('… Paragraph 1981 x')).toBe(true);
        expect(end).toContain('Paragraph 2000 x');
        expect(end).toContain(' … (above the view) Paragraph 1 x');
        expect(end).toHaveLength(3000);
        // About a read's worth above the view and in it each time, not every paragraph.
        expect(restore.reads()).toBeLessThan(200);
      } finally {
        restore();
      }
    });

    it('reads an unscrolled page, or a scrolled one whose text fits, as before', () => {
      const restore = longPage(0);
      try {
        const before = (document.body.innerText).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
        expect(snapshot(freshWorld(), 3000).text).toBe(before.slice(0, 3000));
        window.scrollTo(0, 900);
        expect(snapshot(freshWorld(), 10_000).text).toBe(before);
      } finally {
        restore();
      }
    });
  });

  it('tells which point a click reaches an element at: on it, inside it or on its label, and none when something covers it', () => {
    document.body.innerHTML = '<label id="l">Agree <input data-box id="agree" type="checkbox"></label><button data-box id="go"><span id="inner">Go</span></button><div id="banner">Cookies</div>';
    layout();
    const world = freshWorld();
    const ids = Object.fromEntries(snapshot(world).elements.map((e) => [e.name, e.id]));
    const at: Record<string, Element> = {
      '1,1': document.getElementById('banner')!,
      '2,2': document.getElementById('inner')!,
      '3,3': document.getElementById('l')!,
      '4,4': document.getElementById('go')!,
    };
    const restore = hitTestBy((x, y) => at[`${x},${y}`] ?? null);
    try {
      const hitTest = (id: number, points: Array<[number, number]>) =>
        pageWorld(document, world, { kind: 'hitTest', id, points: points.map(([x, y]) => ({ x, y })), childFrames: 0 });
      expect(hitTest(ids.Go, [[1, 1], [2, 2], [4, 4]])).toEqual({ found: true, reaches: 1, throughFrame: -1 } satisfies HitTestResult);
      expect(hitTest(ids.Go, [[4, 4]])).toEqual({ found: true, reaches: 0, throughFrame: -1 });
      expect(hitTest(ids.Agree, [[1, 1], [3, 3]])).toEqual({ found: true, reaches: 1, throughFrame: -1 });
      expect(hitTest(ids.Go, [[1, 1], [3, 3], [9, 9]])).toEqual({ found: true, reaches: -1, throughFrame: -1 });
      expect(hitTest(999, [[4, 4]])).toEqual({ found: false });
    } finally {
      restore();
    }
  });

  it("tells whether a drag's point lands on a secret field, a card-named one included, through an open shadow root, and not on an ordinary field, text or nothing", () => {
    document.body.innerHTML = `
      <input id="card" name="card_number" aria-label="Card" value="4242424242424242">
      <input id="pw" type="password" value="hunter2">
      <input id="cc" autocomplete="cc-number">
      <textarea id="notes" aria-label="Notes"></textarea>
      <input id="holder" name="cardholderName" aria-label="Name on card">
      <p id="text">Pay now</p>
      <div id="host"></div>`;
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<input id="cardNumberInput">';
    const at: Record<string, Element> = Object.fromEntries(['card', 'pw', 'cc', 'notes', 'holder', 'text'].map((id, i) => [`${i},0`, document.getElementById(id)!]));
    at['6,0'] = document.getElementById('host')!;
    Object.defineProperty(root, 'elementFromPoint', { configurable: true, value: () => root.getElementById('cardNumberInput') });
    const restore = hitTestBy((x, y) => at[`${x},${y}`] ?? null);
    try {
      const secretAt = (x: number) => pageWorld(document, freshWorld(), { kind: 'secretAt', at: { x, y: 0 } });
      expect([0, 1, 2, 3, 4, 5, 6, 7].map(secretAt)).toEqual([true, true, true, false, false, false, true, false]);
    } finally {
      restore();
    }
  });

  it('never counts a point that lands in a frame, or in a custom element sealed from this world, as reaching the control around it', async () => {
    document.body.innerHTML = `
      <div data-box="400x120" id="wrap" tabindex="0" aria-label="More info"><iframe id="buy" src="https://shop.other.test/buy"></iframe></div>
      <label data-box="400x40" id="agree-label">Agree <input data-box id="agree" type="checkbox"><iframe id="terms" src="https://terms.other.test/"></iframe></label>
      <div data-box="400x120" id="host-wrap" role="button" aria-label="Open widget"><div id="host"></div></div>
      <div data-box="400x40" id="sealed-wrap" role="button" aria-label="Pay"><x-pay id="sealed"></x-pay></div>
      <button data-box="400x40" id="icon-button" aria-label="Menu"><x-icon id="icon">menu</x-icon></button>`;
    layout();
    place(document.getElementById('icon')!, 10, 400, 400, 40);
    const inner = document.getElementById('host')!.attachShadow({ mode: 'open' });
    inner.innerHTML = '<iframe id="shadow-frame" src="https://shop.other.test/buy"></iframe>';
    const world = freshWorld();
    const ids = Object.fromEntries(snapshot(world).elements.map((e) => [e.name, e.id]));
    const at: Record<string, Element> = {
      '1,1': document.getElementById('buy')!,
      '2,2': document.getElementById('terms')!,
      '3,3': document.getElementById('host')!,
      '4,4': document.getElementById('sealed')!,
      '5,5': document.getElementById('icon')!,
      '6,6': document.getElementById('wrap')!,
    };
    const restoreHits = hitTestBy((x, y) => at[`${x},${y}`] ?? null);
    // happy-dom's shadow roots have no hit test of their own.
    Object.defineProperty(inner, 'elementFromPoint', { configurable: true, value: () => inner.getElementById('shadow-frame') });
    try {
      const hitTest = (id: number, points: Array<[number, number]>) =>
        pageWorld(document, world, { kind: 'hitTest', id, points: points.map(([x, y]) => ({ x, y })), childFrames: 0 });
      // Every point lands on another site's frame the control wraps, or its label holds.
      expect(hitTest(ids['More info'], [[1, 1]])).toEqual({ found: true, reaches: -1, throughFrame: 0 } satisfies HitTestResult);
      expect(hitTest(ids.Agree, [[2, 2]])).toEqual({ found: true, reaches: -1, throughFrame: 0 });
      // One in an open shadow root inside it, followed there.
      expect(hitTest(ids['Open widget'], [[3, 3]])).toEqual({ found: true, reaches: -1, throughFrame: 0 });
      // A custom element that shows no open shadow root and draws no text of its own there may hold a frame in a closed one.
      expect(hitTest(ids.Pay, [[4, 4]])).toEqual({ found: true, reaches: -1, throughFrame: 0 });
      // A point on the control itself still reaches it.
      expect(hitTest(ids['More info'], [[1, 1], [6, 6]])).toEqual({ found: true, reaches: 1, throughFrame: 0 });
    } finally {
      restoreHits();
    }
    // A custom element's own text, which a click there lands on, reaches its control.
    const restoreText = textBoxesFromParents();
    const restoreIcon = hitTestBy(() => document.getElementById('icon'));
    try {
      expect(pageWorld(document, world, { kind: 'hitTest', id: ids.Menu, points: [{ x: 15, y: 410 }], childFrames: 0 })).toEqual({ found: true, reaches: 0, throughFrame: -1 });
    } finally {
      restoreIcon();
      restoreText();
    }
  });

  it("counts a point on a plain element that may hold a closed shadow root as a frame while the page holds a frame its DOM can't place", () => {
    document.body.innerHTML = '<div data-box="400x120" id="wrap" tabindex="0" aria-label="More info"></div><div data-box="400x40" id="named" role="button">Continue</div>';
    layout();
    document.getElementById('wrap')!.attachShadow({ mode: 'closed' }).innerHTML = '<iframe src="https://shop.other.test/buy"></iframe>';
    const world = freshWorld();
    const ids = Object.fromEntries(snapshot(world).elements.map((e) => [e.name, e.id]));
    const restoreText = textBoxesFromParents();
    const restoreHits = hitTestBy((_x, y) => document.getElementById(y < 130 ? 'wrap' : 'named'));
    try {
      const hitTest = (id: number, y: number, childFrames: number) => pageWorld(document, world, { kind: 'hitTest', id, points: [{ x: 50, y }], childFrames });
      // The frame tree holds one frame the DOM has no owner for, and the point lands on the closed root's host.
      expect(hitTest(ids['More info'], 50, 1)).toEqual({ found: true, reaches: -1, throughFrame: 0 } satisfies HitTestResult);
      // With every frame placed it is an ordinary element.
      expect(hitTest(ids['More info'], 50, 0)).toEqual({ found: true, reaches: 0, throughFrame: -1 });
      // A point on its own text is where a click lands.
      expect(hitTest(ids.Continue, 150, 1)).toEqual({ found: true, reaches: 0, throughFrame: -1 });
    } finally {
      restoreHits();
      restoreText();
    }
  });

  it('locates an element and reports a secret one', () => {
    document.body.innerHTML = SIGN_IN;
    layout();
    const world = freshWorld();
    const page = snapshot(world);
    const pw = page.elements.find((e) => e.name === 'Password')!;
    const go = page.elements.find((e) => e.name === 'Sign in')!;
    expect(pageWorld(document, world, { kind: 'locate', id: pw.id, reveal: false })).toMatchObject({ found: true, secret: true });
    expect(pageWorld(document, world, { kind: 'locate', id: go.id, reveal: false })).toMatchObject({ found: true, secret: false, tag: 'button' });
    expect(pageWorld(document, world, { kind: 'locate', id: 999, reveal: false })).toEqual({ found: false } satisfies LocateResult);
  });

  it('tells whether the focused field is secret', () => {
    document.body.innerHTML = SIGN_IN;
    layout();
    const world = freshWorld();
    (document.getElementById('email') as HTMLInputElement).focus();
    expect(pageWorld(document, world, { kind: 'focusedSecret' })).toEqual({ secret: false, otherSite: false, sealed: false });
    (document.getElementById('pw') as HTMLInputElement).focus();
    expect(pageWorld(document, world, { kind: 'focusedSecret' })).toEqual({ secret: true, otherSite: false, sealed: false });
  });

  it('says when the focus stops on an element that may keep a closed shadow root, and reads the focus inside the root the debugger hands it', () => {
    document.body.innerHTML = '<x-login id="host"></x-login><div id="plain" tabindex="0"></div><input id="field"><x-open id="open"></x-open>';
    const root = document.getElementById('host')!.attachShadow({ mode: 'closed' });
    root.innerHTML = '<input id="pw" type="password"><input id="user">';
    const open = document.getElementById('open')!.attachShadow({ mode: 'open' });
    open.innerHTML = '<input id="inner">';
    const world = freshWorld();
    (root.getElementById('pw') as HTMLInputElement).focus();
    // The world's focus stops at the closed root's host...
    expect(pageWorld(document, world, { kind: 'focusedSecret' })).toEqual({ secret: false, otherSite: false, sealed: true } satisfies FocusedSecret);
    expect(pageWorld(document, world, { kind: 'focusedElement' })).toBe(document.getElementById('host'));
    // ...and from the root the debugger hands it, it finds the field, in its source text too.
    expect(pageWorld(document, world, { kind: 'focusedSecret' }, root)).toEqual({ secret: true, otherSite: false, sealed: false });
    try {
      const fromSource = new Function(`return ${pageWorldFunction({ kind: 'focusedSecret' })}`)() as (from: ShadowRoot) => FocusedSecret;
      expect(fromSource(root)).toEqual({ secret: true, otherSite: false, sealed: false });
    } finally {
      delete (window as unknown as Record<string, unknown>).__coworkBrowserWorld;
    }
    (root.getElementById('user') as HTMLInputElement).focus();
    expect(pageWorld(document, world, { kind: 'focusedSecret' }, root)).toEqual({ secret: false, otherSite: false, sealed: false });
    // A div may keep one too, and so may the body while nothing has the focus; a field, or an element with an open root, shows all it holds.
    const sealed = (focus: () => void) => {
      focus();
      return (pageWorld(document, world, { kind: 'focusedSecret' }) as FocusedSecret).sealed;
    };
    expect(sealed(() => document.getElementById('plain')!.focus())).toBe(true);
    expect(sealed(() => (document.activeElement as HTMLElement).blur())).toBe(true);
    expect(sealed(() => document.getElementById('field')!.focus())).toBe(false);
    expect(sealed(() => (open.getElementById('inner') as HTMLInputElement).focus())).toBe(false);
  });

  it('tells a type step whether the focus is still in its field, and whether it is on a secret one', () => {
    document.body.innerHTML = SIGN_IN;
    layout();
    const world = freshWorld();
    const email = snapshot(world).elements.find((e) => e.name === 'Email')!;
    const typingFocus = () => pageWorld(document, world, { kind: 'typingFocus', id: email.id });
    (document.getElementById('email') as HTMLInputElement).focus();
    expect(typingFocus()).toEqual({ secret: false, inField: true, inControl: false } satisfies TypingFocus);
    (document.getElementById('go') as HTMLButtonElement).focus();
    expect(typingFocus()).toEqual({ secret: false, inField: false, inControl: true });
    (document.getElementById('pw') as HTMLInputElement).focus();
    expect(typingFocus()).toEqual({ secret: true, inField: false, inControl: false });
    document.getElementById('email')!.remove();
    expect(typingFocus()).toEqual({ secret: true, inField: false, inControl: false });
    expect(pageWorld(document, world, { kind: 'typingFocus', id: 999 })).toEqual({ secret: true, inField: false, inControl: false });
  });

  it("tells a type whether its field sits in a control a Space key clicks, so its spaces go in as text: in a button, an element whose role a key activates, an onclick or a tab stop, across open shadow roots, or a field with such a role itself", () => {
    document.body.innerHTML = `
      <button type="button">Delete account <input id="in-button" aria-label="Reason"></button>
      <div role="button" tabindex="0">Delete account <input id="in-role" aria-label="Why"></div>
      <div onclick="void 0"><input id="in-click" aria-label="Note"></div>
      <div tabindex="0"><textarea id="in-stop" aria-label="Comment"></textarea></div>
      <div id="as-button" role="button" contenteditable></div>
      <div id="host" role="button"></div>
      <form><label>Name <input id="plain"></label></form>
      <div tabindex="-1"><input id="in-group" aria-label="City"></div>
      <div id="editor" contenteditable></div>`;
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<input id="in-shadow" aria-label="Code">';
    const world = freshWorld();
    const inControl = (el: Element) => {
      (el as HTMLElement).focus();
      return (pageWorld(document, world, { kind: 'focusedTyping' }) as FocusedTyping).inControl;
    };
    for (const id of ['in-button', 'in-role', 'in-click', 'in-stop', 'as-button']) expect(inControl(document.getElementById(id)!), id).toBe(true);
    expect(inControl(root.getElementById('in-shadow')!), 'in-shadow').toBe(true);
    for (const id of ['plain', 'in-group', 'editor']) expect(inControl(document.getElementById(id)!), id).toBe(false);
    // A type by number reads the same before each key.
    place(document.getElementById('in-button')!, 10, 10, 200, 20);
    place(document.getElementById('plain')!, 10, 40, 200, 20);
    const listed = snapshot(world).elements;
    const typingFocus = (name: string) => pageWorld(document, world, { kind: 'typingFocus', id: listed.find((e) => e.name === name)!.id as number });
    document.getElementById('in-button')!.focus();
    expect(typingFocus('Reason')).toEqual({ secret: false, inField: true, inControl: true });
    document.getElementById('plain')!.focus();
    expect(typingFocus('Name')).toEqual({ secret: false, inField: true, inControl: false });
  });

  it('focuses a text field for typing, selecting its text, and leaves secret fields and other elements alone', () => {
    document.body.innerHTML = SIGN_IN;
    layout();
    const world = freshWorld();
    const byName = Object.fromEntries(snapshot(world).elements.map((e) => [e.name, e.id]));
    const focusField = (name: string, select: boolean) => pageWorld(document, world, { kind: 'focusField', id: byName[name], select });
    const email = document.getElementById('email') as HTMLInputElement;
    expect(focusField('Email', true)).toEqual({ ok: true, selected: true } satisfies FocusFieldResult);
    expect(document.activeElement).toBe(email);
    expect(focusField('Search', true)).toEqual({ ok: true, selected: false });
    email.focus();
    expect(focusField('Password', false)).toEqual({ ok: false, reason: 'secret' });
    expect(focusField('Card number', false)).toEqual({ ok: false, reason: 'secret' });
    expect(focusField('Sign in', false)).toEqual({ ok: false, reason: 'not_text' });
    expect(focusField('Keep me signed in', false)).toEqual({ ok: false, reason: 'not_text' });
    expect(document.activeElement).toBe(email);
    expect(pageWorld(document, world, { kind: 'focusField', id: 999, select: false })).toEqual({ ok: false, reason: 'not_found' });
  });

  it('focuses an element for keys, and a secret one only for keys that edit no text', () => {
    document.body.innerHTML = SIGN_IN;
    layout();
    const world = freshWorld();
    const byName = Object.fromEntries(snapshot(world).elements.map((e) => [e.name, e.id]));
    const focus = (name: string, editing: boolean) => pageWorld(document, world, { kind: 'focus', id: byName[name], editing });
    expect(focus('Sign in', false)).toEqual({ ok: true } satisfies FocusResult);
    expect(document.activeElement).toBe(document.getElementById('go'));
    expect(focus('Password', true)).toEqual({ ok: false, reason: 'secret' });
    expect(document.activeElement).toBe(document.getElementById('go'));
    expect(focus('Password', false)).toEqual({ ok: true });
    expect(document.activeElement).toBe(document.getElementById('pw'));
    expect(pageWorld(document, world, { kind: 'focus', id: 999, editing: false })).toEqual({ ok: false, reason: 'not_found' });
  });

  it('refuses a select into a secret field before it reads any option', () => {
    document.body.innerHTML = '<select data-box id="month" autocomplete="cc-exp-month" aria-label="Month"><option value="01">01</option><option value="12">12</option></select>';
    layout();
    const world = freshWorld();
    const month = snapshot(world).elements[0];
    expect(month).toMatchObject({ value_hidden: true });
    const select = document.getElementById('month') as HTMLSelectElement;
    const fired: string[] = [];
    select.addEventListener('input', () => fired.push('input'));
    select.addEventListener('change', () => fired.push('change'));
    expect(pageWorld(document, world, { kind: 'select', id: month.id, values: ['12'] })).toEqual({ ok: false, reason: 'secret' } satisfies SelectResult);
    expect(pageWorld(document, world, { kind: 'select', id: month.id, values: ['13'] })).toEqual({ ok: false, reason: 'secret' });
    expect(select.value).toBe('01');
    expect(fired).toEqual([]);
  });

  it("treats a field the page names for a card as a secret field: no value in a read or a screenshot, and no type, select or editing key into it, while a container named for a card keeps its text", () => {
    document.body.innerHTML = `
      <section data-box id="card-number-section" aria-label="Card number">Pay with the card ending in 4242.</section>
      <input data-box id="card" name="card_number" aria-label="Card" value="4111111111111111">
      <select data-box id="saved" name="card_no" aria-label="Saved card"><option value="1">Visa</option><option value="2">Amex</option></select>
      <div data-box id="cvv" contenteditable aria-label="CVV">737</div>
      <input data-box id="holder" name="cardholderName" aria-label="Name on card" value="Ada Example">`;
    layout();
    // The editor's secret text sends the read through each text node's box.
    const restore = textBoxesFromParents();
    const world = freshWorld();
    const page = snapshot(world);
    restore();
    const byName = Object.fromEntries(page.elements.map((e) => [e.name, e]));
    expect(byName.Card).toEqual({ id: byName.Card.id, role: 'textbox', name: 'Card', value_hidden: true });
    expect(byName['Saved card']).toEqual({ id: byName['Saved card'].id, role: 'combobox', name: 'Saved card', value_hidden: true });
    expect(byName.CVV).toEqual({ id: byName.CVV.id, role: 'textbox', name: 'CVV', value_hidden: true });
    expect(byName['Name on card']).toMatchObject({ value: 'Ada Example' });
    expect(page.text).toContain('Pay with the card ending in 4242.');
    expect(JSON.stringify(page)).not.toMatch(/4111111111111111|737/);
    const id = (name: string) => byName[name].id as number;
    expect(pageWorld(document, world, { kind: 'focusField', id: id('Card'), select: true })).toEqual({ ok: false, reason: 'secret' } satisfies FocusFieldResult);
    expect(pageWorld(document, world, { kind: 'focusField', id: id('CVV'), select: false })).toEqual({ ok: false, reason: 'secret' });
    expect(pageWorld(document, world, { kind: 'focus', id: id('Card'), editing: true })).toEqual({ ok: false, reason: 'secret' } satisfies FocusResult);
    expect(pageWorld(document, world, { kind: 'select', id: id('Saved card'), values: ['2'] })).toEqual({ ok: false, reason: 'secret' } satisfies SelectResult);
    expect((document.getElementById('saved') as HTMLSelectElement).value).toBe('1');
    expect(pageWorld(document, world, { kind: 'locate', id: id('Card'), reveal: false })).toMatchObject({ found: true, secret: true });
    // A key that edits nothing may focus it; then the focus is on a secret field, for a press or a type.
    expect(pageWorld(document, world, { kind: 'focus', id: id('Card'), editing: false })).toEqual({ ok: true });
    expect(pageWorld(document, world, { kind: 'focusedSecret' })).toEqual({ secret: true, otherSite: false, sealed: false } satisfies FocusedSecret);
    expect(pageWorld(document, world, { kind: 'typingFocus', id: id('Name on card') })).toEqual({ secret: true, inField: false, inControl: false } satisfies TypingFocus);
    // The field named for no card takes typing.
    expect(pageWorld(document, world, { kind: 'focusField', id: id('Name on card'), select: false })).toEqual({ ok: true, selected: false });
    // A screenshot blacks out each field named for a card, and nothing else.
    expect(secretBoxes().secrets).toEqual(['card', 'saved', 'cvv'].map((field) => {
      const { x, y, width, height } = document.getElementById(field)!.getBoundingClientRect();
      return { x, y, width, height };
    }));
  });

  it("reads page.json's checkout page with a card field named card_number as its example lists the elements", () => {
    const fixture = JSON.parse(readFileSync(path.resolve(__dirname, '__fixtures__/browser-contract/page.json'), 'utf-8')) as FixtureFile;
    const example = fixture.examples['a checkout page with a card field named card_number'].body as { elements: unknown[] };
    document.body.innerHTML = `
      <input data-box type="email" aria-label="Email" value="ada@example.test">
      <input data-box aria-label="Name on card" value="Ada Example">
      <input data-box name="card_number" aria-label="Card" value="4242424242424242">
      <button data-box>Pay $42.00</button>`;
    layout();
    const page = snapshot(freshWorld());
    expect(page.elements).toEqual(example.elements);
    expect(JSON.stringify(page)).not.toContain('4242424242424242');
  });

  it("names the node the focus rests on for a page read's focus: the deepest the world sees, the host of a closed root that holds none, and none while nothing has it", async () => {
    document.body.innerHTML = `<button id="a">A</button><button id="b">B</button><x-widget id="host" tabindex="0"></x-widget>
      <iframe id="form" srcdoc="<input id='inner'>"></iframe>`;
    await framesLoad();
    const host = document.getElementById('host')!;
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = '<input id="sealed">';
    const world = freshWorld();
    const focused = (from?: ShadowRoot) => pageWorld(document, world, { kind: 'focusedNode' }, from);
    expect(focused(), 'nothing has the focus').toBeNull();
    document.getElementById('a')!.focus();
    expect(focused()).toBe(document.getElementById('a'));
    document.getElementById('b')!.focus();
    expect(focused()).toBe(document.getElementById('b'));
    // Inside a same-origin frame.
    (frameDoc('form').getElementById('inner') as HTMLInputElement).focus();
    document.getElementById('form')!.focus();
    expect(focused()).toBe(frameDoc('form').getElementById('inner'));
    // A host the focus rests on itself, read from its closed root that holds none.
    host.focus();
    expect(focused()).toBe(host);
    expect(focused(root)).toBe(host);
    // From the closed root the debugger hands it, the field inside, in its source text too.
    (root.getElementById('sealed') as HTMLInputElement).focus();
    expect(focused(root)).toBe(root.getElementById('sealed'));
    try {
      const fromSource = new Function(`return ${pageWorldFunction({ kind: 'focusedNode' })}`)() as (from: ShadowRoot) => Element | null;
      expect(fromSource(root)).toBe(root.getElementById('sealed'));
    } finally {
      delete (window as unknown as Record<string, unknown>).__coworkBrowserWorld;
    }
    (root.getElementById('sealed') as HTMLInputElement).blur();
    expect(focused(), 'nothing has the focus again').toBeNull();
  });

  it('selects an option by value or label and fires input and change', () => {
    document.body.innerHTML = SIGN_IN;
    layout();
    const world = freshWorld();
    const country = snapshot(world).elements.find((e) => e.name === 'Country')!;
    const select = document.getElementById('country') as HTMLSelectElement;
    const fired: string[] = [];
    select.addEventListener('input', () => fired.push('input'));
    select.addEventListener('change', () => fired.push('change'));
    expect(pageWorld(document, world, { kind: 'select', id: country.id, values: ['Canada'] })).toEqual({ ok: true, chosen: ['Canada'] } satisfies SelectResult);
    expect(select.value).toBe('ca');
    expect(fired).toEqual(['input', 'change']);
    expect(pageWorld(document, world, { kind: 'select', id: country.id, values: ['mx'] })).toMatchObject({ ok: true });
    expect(pageWorld(document, world, { kind: 'select', id: country.id, values: ['Peru'] })).toMatchObject({ ok: false, reason: 'no_option', options: ['Mexico', 'Canada'] });
    const go = snapshot(world).elements.find((e) => e.name === 'Sign in')!;
    expect(pageWorld(document, world, { kind: 'select', id: go.id, values: ['x'] })).toEqual({ ok: false, reason: 'not_select' });
  });

  it('runs from its source text, so it needs nothing from this module', () => {
    document.body.innerHTML = SIGN_IN;
    layout();
    const read = () => new Function(`return ${pageWorldSource({ kind: 'snapshot', maxText: 100, maxElements: 300, frames: FRAME_READ_RULES })}`)() as RawSnapshot;
    const before = new Set(Object.getOwnPropertyNames(window));
    try {
      const first = read();
      const second = read();
      expect(first.elements.length).toBeGreaterThan(5);
      expect(second.elements.map((e) => e.id)).toEqual(first.elements.map((e) => e.id));
      /* In the app this state sits on the isolated world's own global. Here
         the test shares the page's window, so it shows up as one name. */
      expect(Object.getOwnPropertyNames(window).filter((name) => !before.has(name))).toEqual(['__coworkBrowserWorld']);
    } finally {
      delete (window as unknown as Record<string, unknown>).__coworkBrowserWorld;
    }
  });
});

describe('frames', () => {
  let restoreHits = () => {};
  beforeEach(() => { restoreHits = hitTestByBoxes(); });
  afterEach(() => restoreHits());

  it('lists every shown frame, on-screen first, with its address, its content box and whether it is in view', async () => {
    document.body.innerHTML = `
      <iframe id="below" src="https://ads.example.test/banner?id=7"></iframe>
      <iframe id="pad" src="https://widgets.example.test/w" style="border: 2px solid black; padding: 3px"></iframe>
      <iframe id="hidden" src="https://track.example.test/" style="display: none"></iframe>
      <div id="host"></div>
      <iframe id="data" src="data:text/html,hi"></iframe>`;
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<iframe id="inner" srcdoc="<p>Inside a widget</p>"></iframe>';
    await framesLoad();
    place(document.getElementById('below')!, 10, window.innerHeight + 100, 300, 250);
    place(document.getElementById('pad')!, 10, 10, 300, 150);
    place(document.getElementById('hidden')!, 0, 0, 0, 0);
    place(root.getElementById('inner')!, 10, 200, 200, 100);
    place(document.getElementById('data')!, 10, 320, 100, 50);
    const world = freshWorld();
    const page = snapshot(world);
    expect(page.frames.map((f) => [f.url, f.read, f.offscreen])).toEqual([
      ['https://widgets.example.test/w', false, false],
      ['about:srcdoc', true, false],
      ['data:text/html,hi', false, false],
      ['https://ads.example.test/banner?id=7', false, true],
    ]);
    // The frame's own viewport: inside its border and padding.
    expect(page.frames[0].box).toEqual({ x: 15, y: 15, width: 290, height: 140 });
    expect(framesByUrl(page)['about:srcdoc']).toMatchObject({ read: true, elements: [], text: 'Inside a widget', truncated: false });
    expect(page.frameOwners).toHaveLength(5);
    expect(page.elements).toEqual([]);
    expect(world.ids.size).toBe(0);
  });

  it("places each frame on its page whatever scrolls, as page.json's at: its content box's top-left plus the page's scroll and each scroll it moves with, the page's none for one fixed to the view, and a column's none for one not laid out in it", async () => {
    document.body.innerHTML = `
      <div id="column" style="overflow: auto; height: 300px"><iframe id="in-column" src="https://forms.other.test/a" style="border: 2px solid black"></iframe></div>
      <iframe id="fixed" src="https://chat.other.test/w" style="position: fixed"></iframe>
      <div id="loose" style="overflow: auto; height: 300px"><iframe id="absolute" src="https://ads.other.test/b" style="position: absolute"></iframe></div>
      <div id="held" style="overflow: auto; height: 300px; position: relative"><iframe id="held-absolute" src="https://ads.other.test/c" style="position: absolute"></iframe></div>
      <div style="transform: translateX(0)"><iframe id="fixed-in-transform" src="https://chat.other.test/x" style="position: fixed"></iframe></div>`;
    await framesLoad();
    const byId = (id: string) => document.getElementById(id)!;
    byId('column').scrollTop = 200;
    byId('loose').scrollTop = 150;
    byId('held').scrollTop = 120;
    window.scrollTo(0, 400);
    try {
      // Where the view draws each frame after those scrolls.
      place(byId('in-column'), 10, 50, 300, 100);
      place(byId('fixed'), 500, 10, 200, 100);
      place(byId('absolute'), 10, 200, 300, 100);
      place(byId('held-absolute'), 10, 320, 300, 100);
      place(byId('fixed-in-transform'), 500, 450, 200, 100);
      const at = Object.fromEntries(snapshot(freshWorld()).frames.map((frame) => [frame.url, frame.at]));
      expect(at).toEqual({
        // Its content box, inside its 2 px border, plus the column's scroll and the page's.
        'https://forms.other.test/a': { x: 12, y: 52 + 200 + 400 },
        // Fixed to the view: no scroll moves it.
        'https://chat.other.test/w': { x: 500, y: 10 },
        // Laid out against the page, not the unpositioned column it sits in.
        'https://ads.other.test/b': { x: 10, y: 200 + 400 },
        // Laid out against the positioned column it sits in.
        'https://ads.other.test/c': { x: 10, y: 320 + 120 + 400 },
        // A transformed box holds a fixed frame, and scrolls with the page.
        'https://chat.other.test/x': { x: 500, y: 450 + 400 },
      });
    } finally {
      window.scrollTo(0, 0);
    }
  });

  it("places a frame inside a frame it read in that frame's own document, by that document's scroll", async () => {
    document.body.innerHTML = `<iframe id="panel" srcdoc="<div style='height: 2000px'></div><iframe id='inner' src='https://video.other.test/v/7'></iframe>"></iframe>`;
    await framesLoad();
    const inner = frameDoc('panel');
    place(document.getElementById('panel')!, 10, 20, 400, 300);
    place(inner.getElementById('inner')!, 30, 40, 200, 100);
    inner.defaultView!.scrollTo(0, 500);
    window.scrollTo(0, 70);
    try {
      const nested = snapshot(freshWorld()).frames.find((frame) => frame.url === 'https://video.other.test/v/7');
      expect(nested?.at).toEqual({ x: 30, y: 40 + 500 });
    } finally {
      window.scrollTo(0, 0);
    }
  });

  it("lists a frame whose document is still the initial about:blank by the http address its owner names, unread, as a lazy frame waiting to load reads, so the scroll that loads it doesn't change its address", async () => {
    document.body.innerHTML = `
      <iframe id="empty" srcdoc=""></iframe>
      <iframe id="blank"></iframe>
      <iframe id="named-blank" src="about:blank"></iframe>
      <iframe id="lazy" loading="lazy" src="https://maps.other.test/embed?q=1"></iframe>
      <iframe id="loading" src="https://chat.other.test/widget"></iframe>
      <iframe id="panel" srcdoc="<iframe id='inner-lazy' loading='lazy' src='https://video.other.test/v/7'></iframe>"></iframe>`;
    await framesLoad();
    /* happy-dom loads no frame by address, so an empty document stands in
       for the initial about:blank one, which this world reaches: a frame
       with no src or src about:blank, and a lazy frame before it loads. */
    const blank = frameDoc('empty');
    Object.defineProperty(blank, 'location', { configurable: true, get: () => ({ href: 'about:blank' }) });
    const inner = frameDoc('panel');
    const owners = ['blank', 'named-blank', 'lazy', 'loading'].map((id) => document.getElementById(id)!);
    for (const owner of [...owners, inner.getElementById('inner-lazy')!]) {
      Object.defineProperty(owner, 'contentDocument', { configurable: true, get: () => blank });
    }
    place(document.getElementById('empty')!, 0, 0, 0, 0);
    place(document.getElementById('blank')!, 10, 10, 300, 100);
    place(document.getElementById('named-blank')!, 10, 120, 300, 100);
    place(document.getElementById('lazy')!, 10, 6000, 300, 100);
    place(document.getElementById('loading')!, 10, 230, 300, 100);
    place(document.getElementById('panel')!, 10, 340, 300, 200);
    place(inner.getElementById('inner-lazy')!, 10, 10, 200, 100);
    const raw = snapshot(freshWorld());
    // An empty document headed for another address holds nothing of it, so it takes none of the frame reads.
    expect(raw.frames.map(({ url, read, offscreen }) => [url, read, offscreen])).toEqual([
      ['about:blank', true, false],
      ['about:blank', true, false],
      ['https://chat.other.test/widget', false, false],
      ['about:srcdoc', true, false],
      ['https://maps.other.test/embed?q=1', false, true],
      ['https://video.other.test/v/7', false, false],
    ]);
    expect(pageAnswer(raw, [], [], []).frames.map((frame) => frame.url)).toEqual([
      'about:blank', 'about:blank', 'https://chat.other.test/widget', 'about:srcdoc', 'https://maps.other.test/embed', 'https://video.other.test/v/7',
    ]);
  });

  it('lists a transparent frame, which still takes clicks, with its box and unread; a hidden one stays out', async () => {
    document.body.innerHTML = `
      <iframe id="clear" src="https://shop.other.test/buy" style="opacity: 0"></iframe>
      <iframe id="clear-same" srcdoc="<p>Readable</p>" style="opacity: 0"></iframe>
      <iframe id="through" src="https://ads.example.test/" style="pointer-events: none"></iframe>
      <iframe id="hidden" src="https://track.example.test/" style="visibility: hidden"></iframe>`;
    await framesLoad();
    place(document.getElementById('clear')!, 10, 10, 300, 100);
    place(document.getElementById('clear-same')!, 10, 120, 300, 100);
    place(document.getElementById('through')!, 10, 230, 300, 100);
    place(document.getElementById('hidden')!, 10, 340, 300, 100);
    const raw = snapshot(freshWorld());
    expect(raw.frames).toEqual([
      { url: 'https://shop.other.test/buy', read: false, box: { x: 10, y: 10, width: 300, height: 100 }, at: { x: 10, y: 10 }, offscreen: false },
      { url: 'about:srcdoc', read: false, box: { x: 10, y: 120, width: 300, height: 100 }, at: { x: 10, y: 120 }, offscreen: false },
      { url: 'https://ads.example.test/', read: false, box: { x: 10, y: 230, width: 300, height: 100 }, at: { x: 10, y: 230 }, offscreen: false },
    ]);
    expect(JSON.stringify(raw)).not.toContain('Readable');
    expect(pageAnswer(raw, [], [], []).frames.map((frame) => frame.box)).toEqual([
      { x: 10, y: 10, width: 300, height: 100 },
      { x: 10, y: 120, width: 300, height: 100 },
      { x: 10, y: 230, width: 300, height: 100 },
    ]);
  });

  it('reads a same-origin frame only where the person sees it: in view, not faint, masked, blended or filtered out of sight, and found by a hit test; the rest stay listed with their boxes', async () => {
    // Each case alone on its page: the frame's own style, and the style of a box around it.
    const cases: Array<[string, string, string, boolean]> = [
      ['shown', '', '', true],
      ['tinted', 'filter: grayscale(1) drop-shadow(0 0 2px rgb(0, 0, 0))', '', true],
      ['covered', '', '', false],
      ['below', '', '', false],
      ['faint', 'opacity: 0.05', '', false],
      ['faint around', 'opacity: 0.4', 'opacity: 0.2', false],
      ['faded', 'filter: opacity(5%)', '', false],
      ['masked', 'mask-image: linear-gradient(transparent, transparent)', '', false],
      ['mask box', '-webkit-mask-box-image-source: linear-gradient(transparent, transparent)', '', false],
      ['mask border', 'mask-border-source: linear-gradient(transparent, transparent)', '', false],
      ['darkened', 'filter: brightness(0)', '', false],
      ['blurred', 'filter: blur(40px)', '', false],
      ['inverted around', '', 'filter: invert(1) brightness(0)', false],
      ['blended', 'mix-blend-mode: multiply', '', false],
      // Filters weighed all together, as the web pod weighs them: a dark mode, a slight dimming or a slight blur leaves a frame readable.
      ['dark mode', 'filter: invert(1) hue-rotate(180deg)', '', true],
      ['dark mode around', '', 'filter: invert(90%) hue-rotate(180deg) contrast(0.9)', true],
      ['dimmed', 'filter: brightness(0.9)', '', true],
      ['softened', 'filter: blur(1px)', '', true],
      ['flattened', 'filter: contrast(0.3)', '', false],
      ['blurred twice', 'filter: blur(1.5px)', 'filter: blur(1.5px)', false],
      ['dimmed to black around', 'filter: brightness(0.6)', 'filter: brightness(0.5) contrast(0.8)', false],
      ['filtered by an image', 'filter: url(#hide)', '', false],
    ];
    const byBoxes = document.elementFromPoint;
    for (const [name, style, around, read] of cases) {
      document.body.innerHTML = `<div id="around" style="${around}"><iframe id="f" style="${style}" srcdoc="<p>Inside the frame</p>"></iframe></div><div id="cover"></div>`;
      await framesLoad();
      const y = name === 'below' ? window.innerHeight + 50 : 100;
      place(document.getElementById('around')!, 0, y, 300, 40);
      place(document.getElementById('f')!, 0, y, 300, 40);
      // A box laid over the whole frame: a hit test there finds the box.
      const cover = document.getElementById('cover')!;
      if (name === 'covered') place(cover, 0, y, 300, 40);
      const restoreCover = hitTestBy((x, at) => (name === 'covered' ? cover : byBoxes.call(document, x, at)));
      try {
        const [frame] = snapshot(freshWorld()).frames;
        expect.soft(frame, name).toMatchObject({ url: 'about:srcdoc', read, box: { x: 0, y, width: 300, height: 40 } });
        expect.soft(JSON.stringify(frame).includes('Inside the frame'), name).toBe(read);
      } finally {
        restoreCover();
      }
    }
  });

  it('leaves unread a same-origin frame drawn at under half its size, or with less than 32 px of it in view either way', async () => {
    // Each case alone on its page: the frame's layout size, its box as drawn, and whether a read reads it.
    const cases: Array<[string, { width: number; height: number }, { x: number; y: number; width: number; height: number }, boolean]> = [
      ['drawn at its size', { width: 400, height: 200 }, { x: 0, y: 100, width: 400, height: 200 }, true],
      ['drawn at 80%', { width: 400, height: 200 }, { x: 0, y: 100, width: 320, height: 160 }, true],
      ['drawn at 40%', { width: 400, height: 200 }, { x: 0, y: 100, width: 160, height: 80 }, false],
      ['squeezed to 40% high', { width: 400, height: 200 }, { x: 0, y: 100, width: 400, height: 80 }, false],
      ['20 px of it in view', { width: 400, height: 200 }, { x: 0, y: window.innerHeight - 20, width: 400, height: 200 }, false],
      ['20 px of it in view at the left', { width: 400, height: 200 }, { x: -380, y: 100, width: 400, height: 200 }, false],
    ];
    for (const [name, layoutSize, drawn, read] of cases) {
      document.body.innerHTML = '<iframe id="f" srcdoc="<p>Inside the frame</p>"></iframe>';
      await framesLoad();
      const frame = document.getElementById('f')!;
      place(frame, drawn.x, drawn.y, drawn.width, drawn.height);
      Object.defineProperty(frame, 'offsetWidth', { configurable: true, value: layoutSize.width });
      Object.defineProperty(frame, 'offsetHeight', { configurable: true, value: layoutSize.height });
      const [listed] = snapshot(freshWorld()).frames;
      expect.soft(listed, name).toMatchObject({ url: 'about:srcdoc', read, box: drawn });
    }
  });

  it('reads a same-origin frame only when a hit test finds it at most of its sample points, so a cover with holes leaves it unread and a banner across part of it does not', async () => {
    document.body.innerHTML = '<iframe id="f" srcdoc="<p>Inside the frame</p>"></iframe><div id="cover"></div>';
    await framesLoad();
    const frame = document.getElementById('f')!;
    const cover = document.getElementById('cover')!;
    place(frame, 0, 100, 300, 200);
    const readWith = (hit: (x: number, y: number) => Element | null): RawFrame => {
      const restore = hitTestBy(hit);
      try {
        return snapshot(freshWorld()).frames[0];
      } finally {
        restore();
      }
    };
    // A cover with a hole at the middle and a quarter in from each corner of the frame.
    const fivePoints = [[150, 200], [75, 150], [225, 150], [75, 250], [225, 250]];
    const near = (x: number, y: number, points: number[][]) => points.some(([px, py]) => Math.abs(px - x) <= 2 && Math.abs(py - y) <= 2);
    expect(readWith((x, y) => (near(x, y, fivePoints) ? frame : cover)).read).toBe(false);
    // A cover with a hole at the middle of each cell of a 5 by 5 grid over the frame.
    const grid = [0.1, 0.3, 0.5, 0.7, 0.9].flatMap((fy) => [0.1, 0.3, 0.5, 0.7, 0.9].map((fx) => [Math.floor(300 * fx), Math.floor(100 + 200 * fy)]));
    expect(readWith((x, y) => (near(x, y, grid) ? frame : cover)).read).toBe(false);
    // A banner across the frame's top fifth, and one down its right side.
    expect(readWith((x, y) => (y < 140 ? cover : frame)).read).toBe(true);
    expect(readWith((x, _y) => (x >= 240 ? cover : frame)).read).toBe(true);
    // Under half of it seen.
    expect(readWith((x, _y) => (x >= 120 ? cover : frame)).read).toBe(false);
  });

  it("samples a frame's hit test at points new to each read, inside its part in view", async () => {
    document.body.innerHTML = '<iframe id="f" srcdoc="<p>Inside the frame</p>"></iframe>';
    await framesLoad();
    const frame = document.getElementById('f')!;
    place(frame, -100, 100, 400, 200);
    // The page text's own look at the middle of the view, whether the page is scrolled, is no frame's point.
    const textLook = `${window.innerWidth / 2},${window.innerHeight / 2}`;
    const pointsOfRead = (): string[] => {
      const points: string[] = [];
      const restore = hitTestBy((x, y) => {
        if (`${x},${y}` !== textLook) points.push(`${x},${y}`);
        return frame;
      });
      try {
        expect(snapshot(freshWorld()).frames[0].read).toBe(true);
      } finally {
        restore();
      }
      return points;
    };
    const first = pointsOfRead();
    const second = pointsOfRead();
    // It stops once most points found the frame.
    expect(first).toHaveLength(13);
    expect(second).not.toEqual(first);
    for (const point of [...first, ...second]) {
      const [x, y] = point.split(',').map(Number);
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
      expect(x >= 0 && x < 300 && y >= 100 && y < 300, point).toBe(true);
    }
  });

  it("reads a same-origin frame's controls and text with no ids and no field values; a select keeps its value", async () => {
    document.body.innerHTML = `<iframe id="news" srcdoc="${`
      <p>Get the weekly digest.</p>
      <label>Email <input id='email' value='ada@example.test'></label>
      <textarea id='note' aria-label='Note'></textarea>
      <div id='draft' contenteditable aria-label='Draft'>draft words</div>
      <select id='when' aria-label='How often'><option>Weekly</option><option selected>Daily</option></select>
      <label><input id='agree' type='checkbox' checked> Agree</label>
      <button id='go'>Subscribe</button>`.replace(/"/g, '&quot;')}"></iframe>`;
    await framesLoad();
    place(document.getElementById('news')!, 0, 0, 600, 400);
    const inner = frameDoc('news');
    inner.querySelectorAll('p, input, textarea, [contenteditable], select, button').forEach((el, i) => place(el, 10, 10 + i * 30, 200, 20));
    // What the person typed, which no element of a frame carries.
    (inner.getElementById('note') as HTMLTextAreaElement).value = 'typed words';
    (inner.getElementById('email') as HTMLInputElement).value = 'ada@example.test';
    const world = freshWorld();
    const restore = textBoxesFromParents(inner);
    const [frame] = (() => {
      try {
        return snapshot(world).frames;
      } finally {
        restore();
      }
    })();
    expect(frame).toMatchObject({ url: 'about:srcdoc', read: true, truncated: false });
    expect(frame.read && frame.elements).toEqual([
      { role: 'textbox', name: 'Email' },
      { role: 'textbox', name: 'Note' },
      { role: 'textbox', name: 'Draft' },
      { role: 'combobox', name: 'How often', value: 'Daily', options: ['Weekly', 'Daily'] },
      { role: 'checkbox', name: 'Agree', checked: true },
      { role: 'button', name: 'Subscribe' },
    ]);
    expect(frame.read && frame.text).toContain('Get the weekly digest.');
    expect(JSON.stringify(frame)).not.toMatch(/ada@example\.test|typed words|draft words/);
    expect(world.ids.size).toBe(0);
  });

  it("carries no editor's text, what the person typed there, in the frame's text or as an unlabelled editor's name", async () => {
    document.body.innerHTML = `<iframe id="mail" srcdoc="${`
      <p>Write to us.</p>
      <div id='labelled' contenteditable aria-label='Message'>draft words</div>
      <div id='bare' contenteditable>bare words</div>
      <div id='card' tabindex='0'>Reply: <span contenteditable>inline words</span></div>
      <button id='send' aria-labelledby='bare'></button>`.replace(/"/g, '&quot;')}"></iframe>`;
    await framesLoad();
    place(document.getElementById('mail')!, 0, 0, 600, 400);
    const inner = frameDoc('mail');
    inner.querySelectorAll('p, [contenteditable], [tabindex], button').forEach((el, i) => place(el, 10, 10 + i * 30, 200, 20));
    const restore = textBoxesFromParents(inner);
    try {
      const [frame] = snapshot(freshWorld()).frames;
      expect(frame.read).toBe(true);
      if (!frame.read) return;
      expect(frame.text).toContain('Write to us.');
      expect(frame.elements).toEqual([
        { role: 'textbox', name: 'Message' },
        { role: 'textbox', name: '' },
        { role: 'clickable', name: 'Reply:' },
        { role: 'textbox', name: '' },
        { role: 'button', name: '' },
      ]);
      expect(JSON.stringify(frame)).not.toMatch(/draft words|bare words|inline words/);
    } finally {
      restore();
    }
  });

  it("carries no text of an editor that CSS alone makes editable, in the frame's text or in a name around it", async () => {
    document.body.innerHTML = `<iframe id="mail" srcdoc="${`
      <p>Compose</p>
      <div id='card' tabindex='0'>To: <div id='draft' style='-webkit-user-modify: read-write'>css draft words</div></div>
      <button>Send</button>`.replace(/"/g, '&quot;')}"></iframe>`;
    await framesLoad();
    place(document.getElementById('mail')!, 0, 0, 600, 400);
    const inner = frameDoc('mail');
    // Chromium takes typing there, though isContentEditable answers false.
    expect(inner.getElementById('draft')!.isContentEditable).toBe(false);
    inner.querySelectorAll('p, [tabindex], #draft, button').forEach((el, i) => place(el, 10, 10 + i * 30, 200, 20));
    const restore = textBoxesFromParents(inner);
    try {
      const [frame] = snapshot(freshWorld()).frames;
      expect(frame.read).toBe(true);
      if (!frame.read) return;
      expect(frame.text).toContain('Compose');
      expect(frame.text).toContain('Send');
      expect(frame.elements).toEqual([{ role: 'clickable', name: 'To:' }, { role: 'button', name: 'Send' }]);
      expect(JSON.stringify(frame)).not.toMatch(/css draft words/);
    } finally {
      restore();
    }
  });

  it('never reads a frame that holds a secret, card-named or sign-in field, sits on a payment or sign-in host, is a consent page or is under 32 px, and reads every other frame it finds the person sees, past the five the look then keeps', async () => {
    const frames: Array<[string, string, string]> = [
      ['password', '', "<input type='password'>"],
      ['card', '', "<input name='cardnumber' placeholder='Card'>"],
      ['code', '', "<input autocomplete='one-time-code'>"],
      ['username', '', "<input autocomplete='username'>"],
      ['editor', '', "<div contenteditable autocomplete='cc-number'>4242 4242 4242 4242</div>"],
      ['stripe', 'https://js.stripe.com/v3/elements-inner-card', '<p>Card</p>'],
      ['google', 'https://accounts.google.com/signin', '<p>Choose an account</p>'],
      ['consent', 'https://auth.example.test/oauth2/authorize?client_id=1&amp;response_type=code', '<p>Allow access</p>'],
      ['tiny', '', '<p>Tiny</p>'],
      ...Array.from({ length: 11 }, (_, i): [string, string, string] => [`plain${i + 1}`, '', `<p>Plain ${i + 1}</p>`]),
    ];
    document.body.innerHTML = frames.map(([id, src, body]) => `<iframe id="${id}"${src ? ` src="${src}"` : ''} srcdoc="${body}"></iframe>`).join('');
    await framesLoad();
    frames.forEach(([id], i) => place(document.getElementById(id)!, 0, i * 38, id === 'tiny' ? 400 : 300, id === 'tiny' ? 20 : 36));
    const page = snapshot(freshWorld());
    expect(page.frames.map((f) => f.read)).toEqual([...frames.slice(0, 9).map(() => false), ...Array(11).fill(true)]);
    expect(JSON.stringify(page)).not.toMatch(/4242|Choose an account|Allow access|Card/);
  });

  it("starts no frame read once FRAME_READ_RULES.phaseMs has passed since its first, and lists the rest unread with their boxes", async () => {
    document.body.innerHTML = Array.from({ length: 6 }, (_, i) => `<iframe id="f${i}" srcdoc="<p>Plain ${i}</p>"></iframe>`).join('');
    await framesLoad();
    for (let i = 0; i < 6; i += 1) place(document.getElementById(`f${i}`)!, 0, i * 40, 300, 36);
    // Each look at the clock comes 0.7 s after the last.
    let clock = 0;
    const ticking = vi.spyOn(window.performance, 'now').mockImplementation(() => (clock += 700));
    try {
      const page = snapshot(freshWorld());
      expect(page.frames.map((f) => f.read)).toEqual([true, true, false, false, false, false]);
      expect(page.frames.every((f) => f.box.width === 300)).toBe(true);
    } finally {
      ticking.mockRestore();
    }
    expect(FRAME_READ_RULES.phaseMs).toBe(2_000);
  });

  it('lists each frame inside a same-origin frame it reads as a frame of its own, unread, with its box where the page draws it, and gives main every frame owner it found there', async () => {
    document.body.innerHTML = `<iframe id="panel" srcdoc="<p>Embedded account panel</p><iframe id='radios' src='https://other.test/radios'></iframe><iframe id='later' src='https://other.test/more'></iframe><iframe id='gone' src='https://other.test/gone'></iframe>"></iframe>`;
    await framesLoad();
    place(document.getElementById('panel')!, 20, 100, 400, 300);
    const inner = frameDoc('panel');
    place(inner.getElementById('radios')!, 10, 50, 200, 100);
    place(inner.getElementById('later')!, 10, 1000, 200, 100);
    place(inner.getElementById('gone')!, 0, 0, 0, 0);
    const page = snapshot(freshWorld());
    expect(page.frames.map(({ url, read, box, offscreen }) => ({ url, read, box, offscreen }))).toEqual([
      { url: 'about:srcdoc', read: true, box: { x: 20, y: 100, width: 400, height: 300 }, offscreen: false },
      { url: 'https://other.test/radios', read: false, box: { x: 30, y: 150, width: 200, height: 100 }, offscreen: false },
      { url: 'https://other.test/more', read: false, box: { x: 30, y: 1100, width: 200, height: 100 }, offscreen: true },
    ]);
    // Each in its own document's content: a frame inside the panel, in the panel's.
    expect(page.frames.map(({ at }) => at)).toEqual([{ x: 20, y: 100 }, { x: 10, y: 50 }, { x: 10, y: 1000 }]);
    expect(page.frames[0]).toMatchObject({ text: 'Embedded account panel', elements: [] });
    expect(page.nestedOwners).toEqual([
      { url: 'https://other.test/radios', visible: true, framed: true },
      { url: 'https://other.test/more', visible: false, framed: true },
      { url: 'https://other.test/gone', visible: false, framed: true },
    ]);
    // A frame it doesn't read lists nothing inside it.
    place(document.getElementById('panel')!, 20, 100, 400, 20);
    const small = snapshot(freshWorld());
    expect(small.frames.map(({ url, read }) => [url, read])).toEqual([['about:srcdoc', false]]);
    expect(small.nestedOwners).toEqual([]);
  });

  it("caps a frame's elements, in-view first, and its text", async () => {
    const buttons = Array.from({ length: 60 }, (_, i) => `<button>Button ${i + 1}</button>`).join('');
    document.body.innerHTML = `<iframe id="many" srcdoc="<p>${'word '.repeat(400)}</p>${buttons}"></iframe>`;
    await framesLoad();
    place(document.getElementById('many')!, 0, 0, 600, 400);
    frameDoc('many').querySelectorAll('button').forEach((el, i) => place(el, 10, i < 10 ? 2000 + i * 30 : (i - 10) * 10, 80, 8));
    const [frame] = snapshot(freshWorld()).frames;
    expect(frame.read).toBe(true);
    if (!frame.read) return;
    expect(frame.elements).toHaveLength(ELEMENTS_PER_FRAME);
    expect(frame.elements[0]).toEqual({ role: 'button', name: 'Button 11' });
    expect(frame.truncated).toBe(true);
    expect(frame.text).toHaveLength(TEXT_PER_FRAME);
  });

  it("reads no frame when asked for none, as a screenshot's labels are", async () => {
    document.body.innerHTML = '<iframe id="f" srcdoc="<p>Inside</p>"></iframe>';
    await framesLoad();
    place(document.getElementById('f')!, 0, 0, 300, 200);
    const page = pageWorld(document, freshWorld(), { kind: 'snapshot', maxText: 0, maxElements: 300, frames: null }) as RawSnapshot;
    expect(page.frames).toEqual([]);
    expect(page.frameOwners).toHaveLength(1);
  });

  it("follows the focus into a same-origin frame, so an editing key into its password field is refused; another site's frame can't be read", async () => {
    document.body.innerHTML = '<iframe id="login" srcdoc="<input id=\'pw\' type=\'password\'><input id=\'user\'>"></iframe><iframe id="other" src="https://pay.example.test/"></iframe>';
    await framesLoad();
    const world = freshWorld();
    (frameDoc('login').getElementById('pw') as HTMLInputElement).focus();
    document.getElementById('login')!.focus();
    expect(pageWorld(document, world, { kind: 'focusedSecret' })).toEqual({ secret: true, otherSite: false, sealed: false } satisfies FocusedSecret);
    (frameDoc('login').getElementById('user') as HTMLInputElement).focus();
    expect(pageWorld(document, world, { kind: 'focusedSecret' })).toEqual({ secret: false, otherSite: false, sealed: false });
    document.getElementById('other')!.focus();
    expect(pageWorld(document, world, { kind: 'focusedSecret' })).toEqual({ secret: false, otherSite: true, sealed: false });
    // The frame the debugger then reads the focus in: the owner of the one this world can't read, and none while the focus is in reach.
    expect(pageWorld(document, world, { kind: 'focusedFrame' })).toBe(document.getElementById('other'));
    (frameDoc('login').getElementById('user') as HTMLInputElement).focus();
    document.getElementById('login')!.focus();
    expect(pageWorld(document, world, { kind: 'focusedFrame' })).toBeNull();
  });

  it('answers the text entry a type with focused true types into: a text, search, email, url, tel or number input, a textarea or an editor that is not secret, in the page or a same-origin frame', async () => {
    document.body.innerHTML = `
      <input id="text"><input id="odd" type="nonsense"><input id="search" type="search"><input id="email" type="email">
      <input id="url" type="url"><input id="tel" type="tel"><input id="number" type="number"><textarea id="note"></textarea>
      <div id="editor" contenteditable></div><x-editor id="custom" contenteditable="plaintext-only" tabindex="0"></x-editor>
      <input id="pw" type="password"><input id="otp" autocomplete="one-time-code"><input id="card" autocomplete="cc-number">
      <div id="card-editor" contenteditable autocomplete="cc-number"></div>
      <input id="card-hint" placeholder="Card number"><input id="card-name" name="cardnumber"><input id="cvc" aria-label="CVC">
      <input id="fixed" readonly value="Fixed"><textarea id="fixed-note" readonly></textarea>
      <input id="date" type="date"><input id="box" type="checkbox"><input id="range" type="range"><button id="go">Go</button>
      <select id="pick"><option>A</option></select><a id="link" href="/x">Link</a>
      <iframe id="form" srcdoc="<input id='inner' type='email'><input id='innerpw' type='password'>"></iframe>
      <iframe id="whole" srcdoc="<body contenteditable='true'>draft</body>"></iframe>
      <iframe id="plain" srcdoc="<p>Nothing to type into</p>"></iframe>`;
    await framesLoad();
    const world = freshWorld();
    const entry = () => pageWorld(document, world, { kind: 'focusedEntry' });
    for (const id of ['text', 'odd', 'search', 'email', 'url', 'tel', 'number', 'note', 'editor', 'custom']) {
      (document.getElementById(id) as HTMLElement).focus();
      expect(entry(), id).toBe(document.getElementById(id));
    }
    for (const id of ['pw', 'otp', 'card', 'card-editor', 'card-hint', 'card-name', 'cvc', 'fixed', 'fixed-note', 'date', 'box', 'range', 'go', 'pick', 'link']) {
      (document.getElementById(id) as HTMLElement).focus();
      expect(entry(), id).toBeNull();
    }
    (document.activeElement as HTMLElement).blur();
    expect(entry(), 'nothing focused').toBeNull();
    // Inside a same-origin frame: its field, never its password field.
    (frameDoc('form').getElementById('inner') as HTMLInputElement).focus();
    document.getElementById('form')!.focus();
    expect(entry()).toBe(frameDoc('form').getElementById('inner'));
    (frameDoc('form').getElementById('innerpw') as HTMLInputElement).focus();
    document.getElementById('form')!.focus();
    expect(entry()).toBeNull();
    // A frame whose whole document is an editor types into its body; a frame with none takes no typing.
    document.getElementById('whole')!.focus();
    expect(entry()).toBe(frameDoc('whole').body);
    document.getElementById('plain')!.focus();
    expect(entry()).toBeNull();
  });

  it('says a type with focused true finds the focus on a field the page names for a card, by its name, id, label or placeholder, in the page or a same-origin frame, so the type is refused as a secret field', async () => {
    document.body.innerHTML = `
      <input id="hint" placeholder="Card number"><input id="name" name="cardnumber"><input id="cvc" aria-label="CVC">
      <input id="code" name="security_code"><input id="email" type="email" aria-label="Email"><button id="go">Go</button>
      <iframe id="form" srcdoc="<input id='inner-card' placeholder='Card number'><input id='inner-name' aria-label='Name'>"></iframe>`;
    await framesLoad();
    const world = freshWorld();
    const typing = () => pageWorld(document, world, { kind: 'focusedTyping' }) as FocusedTyping;
    for (const id of ['hint', 'name', 'cvc', 'code']) {
      (document.getElementById(id) as HTMLElement).focus();
      expect(typing().cardNamed, id).toBe(true);
    }
    for (const id of ['email', 'go']) {
      (document.getElementById(id) as HTMLElement).focus();
      expect(typing().cardNamed, id).toBe(false);
    }
    (frameDoc('form').getElementById('inner-card') as HTMLInputElement).focus();
    document.getElementById('form')!.focus();
    expect(typing()).toEqual({ cardNamed: true, inControl: false } satisfies FocusedTyping);
    (frameDoc('form').getElementById('inner-name') as HTMLInputElement).focus();
    document.getElementById('form')!.focus();
    expect(typing()).toEqual({ cardNamed: false, inControl: false });
  });

  /* page.json's card-field examples (anton's tests/fixtures/browser_contract,
     copied byte for byte into __fixtures__/browser-contract): values of a
     field's name, id, aria-label or placeholder that name it for a card, or
     don't, and a field named for one only by two of its attributes
     together. Each field below carries the attributes one example gives it. */
  interface CardFieldExample {
    card_named: boolean;
    values?: string[];
    attributes?: Record<string, string>;
  }
  interface CardField {
    attributes: Record<string, string>;
    cardNamed: boolean;
  }
  /* The fields page.json's examples give: each of an example's values in
     the attributes `placed` puts it in, and an example's attributes
     together. */
  const cardFields = (placed: (value: string, index: number) => Array<Record<string, string>>): CardField[] => {
    const page = JSON.parse(readFileSync(path.resolve(__dirname, '__fixtures__/browser-contract/page.json'), 'utf-8')) as FixtureFile;
    return Object.values(page.examples)
      .filter((example) => example.kind === 'classification')
      .flatMap((example) => {
        const body = example.body as CardFieldExample;
        const fields = [...(body.values ?? []).flatMap(placed), ...(body.attributes ? [body.attributes] : [])];
        return fields.map((attributes) => ({ attributes, cardNamed: body.card_named }));
      });
  };
  /* Each value in each attribute alone. */
  const inEachAttribute = (value: string) => CARD_FIELD_ATTRIBUTES.map((attr) => ({ [attr]: value }));
  /* Each value once, in the attributes in turn. */
  const inOneAttribute = (value: string, index: number) => [{ [CARD_FIELD_ATTRIBUTES[index % CARD_FIELD_ATTRIBUTES.length]]: value }];
  const describeField = (attributes: Record<string, string>) => Object.entries(attributes).map(([attr, value]) => `${attr}=${JSON.stringify(value)}`).join(' ');

  it("names a field for a card by page.json's one rule, each value in each attribute alone and two attributes together, so a type with focused true finds it card-named and no text entry", () => {
    const fields = cardFields(inEachAttribute);
    expect(fields.filter((f) => f.cardNamed).length).toBeGreaterThan(fields.length / 3);
    expect(fields.some((f) => !f.cardNamed)).toBe(true);
    const world = freshWorld();
    const wrong: string[] = [];
    for (const { attributes, cardNamed } of fields) {
      const field = document.createElement('input');
      for (const [attr, value] of Object.entries(attributes)) field.setAttribute(attr, value);
      document.body.replaceChildren(field);
      field.focus();
      const typing = pageWorld(document, world, { kind: 'focusedTyping' }) as FocusedTyping;
      const entry = pageWorld(document, world, { kind: 'focusedEntry' });
      if (typing.cardNamed !== cardNamed || (entry === null) !== cardNamed) {
        wrong.push(`${describeField(attributes)}: card-named ${typing.cardNamed}, text entry ${entry !== null}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('never reads a same-origin frame that holds a field page.json names for a card, and reads one whose field it names for none', async () => {
    const fields = cardFields(inOneAttribute);
    document.body.innerHTML = fields.map((_, i) => `<iframe id="card-${i}" srcdoc="<input id='field'>"></iframe>`).join('');
    await framesLoad();
    fields.forEach(({ attributes }, i) => {
      const field = frameDoc(`card-${i}`).getElementById('field')!;
      for (const [attr, value] of Object.entries(attributes)) field.setAttribute(attr, value);
      // Eight frames to a row, each 120 by 36, all in view.
      place(document.getElementById(`card-${i}`)!, (i % 8) * 125, Math.floor(i / 8) * 38, 120, 36);
    });
    expect([window.innerWidth, window.innerHeight]).toEqual([1024, 768]);
    expect(Math.ceil(fields.length / 8) * 38).toBeLessThan(768);
    const page = snapshot(freshWorld());
    expect(page.frames).toHaveLength(fields.length);
    const wrong = fields
      .filter(({ cardNamed }, i) => page.frames[i].read === cardNamed)
      .map(({ attributes, cardNamed }) => `${describeField(attributes)}: ${cardNamed ? 'card-named, yet its frame was read' : 'named for no card, yet its frame was left unread'}`);
    expect(wrong).toEqual([]);
  });

  it('finds what a screenshot must hide: secret fields in the page, its open shadow roots and its same-origin frames, payment frames by address, and every frame from another site', async () => {
    document.body.innerHTML = `
      <input id="pw" type="password">
      <div id="host"></div>
      <iframe id="form" style="border: 2px solid black; padding: 3px" srcdoc="<input id='otp' autocomplete='one-time-code'>"></iframe>
      <iframe id="pay" src="https://js.stripe.com/v3/elements-inner-card"></iframe>
      <iframe id="ads" src="https://ads.example.test/"></iframe>`;
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<input id="card" autocomplete="cc-number">';
    await framesLoad();
    place(document.getElementById('pw')!, 10, 10, 100, 20);
    place(root.getElementById('card')!, 10, 40, 100, 20);
    place(document.getElementById('form')!, 50, 200, 300, 100);
    place(frameDoc('form').getElementById('otp')!, 5, 5, 80, 20);
    place(document.getElementById('pay')!, 10, 320, 300, 40);
    place(document.getElementById('ads')!, 10, 400, 300, 250);
    const found = secretBoxes();
    expect(found.secrets).toEqual([
      { x: 10, y: 10, width: 100, height: 20 },
      { x: 10, y: 40, width: 100, height: 20 },
      { x: 60, y: 210, width: 80, height: 20 },
    ]);
    expect(found.paymentFrames).toEqual([{ x: 10, y: 320, width: 300, height: 40 }]);
    expect(found.otherSiteFrames).toEqual([{ x: 10, y: 320, width: 300, height: 40 }, { x: 10, y: 400, width: 300, height: 250 }]);
    expect(found.owners).toBe(3);
    // A payment frame the page's DOM accounts for hides itself alone.
    expect(screenshotMasks(found, ['https://js.stripe.com/v3/elements-inner-card', 'https://ads.example.test/'], 3)).toEqual([...found.secrets, ...found.paymentFrames]);
    // One it doesn't (nested in another site's frame, or redirected there) hides every frame from another site.
    expect(screenshotMasks(found, ['https://js.stripe.com/v3/elements-inner-card', 'https://ads.example.test/', 'https://js.stripe.com/v3/controller.html'], 3)).toEqual([...found.secrets, ...found.paymentFrames, ...found.otherSiteFrames]);
  });

  it("places a same-origin frame's secret field where the frame draws it, at twice or half its size, and blacks out whole one a transform or an offset path turns", async () => {
    const frame = (id: string, style = '') => `<iframe id="${id}" style="border: 0; ${style}" srcdoc="<input id='pw' type='password'>"></iframe>`;
    // An offset path turns a frame while its transform, rotate and scale stay none: its own, or one on an element it is drawn in.
    document.body.innerHTML = [frame('twice'), frame('half'), frame('turned'), frame('along', "offset-path: path('M 600 90 L 700 90'); offset-rotate: 30deg"),
      `<div style="offset-path: path('M 600 290 L 700 290'); offset-rotate: 30deg">${frame('inside')}</div>`].join('');
    await framesLoad();
    // Each frame is laid out 200 by 100 and drawn as its box says.
    const drawn: Record<string, [number, number, number, number]> = {
      twice: [0, 0, 400, 200], half: [0, 300, 100, 50], turned: [200, 400, 220, 120], along: [450, 0, 260, 180], inside: [450, 200, 260, 180],
    };
    for (const [id, [x, y, width, height]] of Object.entries(drawn)) {
      const frame = document.getElementById(id)!;
      place(frame, x, y, width, height);
      Object.defineProperty(frame, 'offsetWidth', { configurable: true, value: 200 });
      Object.defineProperty(frame, 'offsetHeight', { configurable: true, value: 100 });
      place(frameDoc(id).getElementById('pw')!, 10, 20, 50, 10);
    }
    document.getElementById('turned')!.style.transform = 'matrix(0.98, 0.17, -0.17, 0.98, 0, 0)';
    expect(secretBoxes().secrets).toEqual([
      { x: 20, y: 40, width: 100, height: 20 },
      { x: 5, y: 310, width: 25, height: 5 },
      { x: 200, y: 400, width: 220, height: 120 },
      { x: 450, y: 0, width: 260, height: 180 },
      { x: 450, y: 200, width: 260, height: 180 },
    ]);
  });

  it('blacks out the copy -webkit-box-reflect draws of a secret field, scaled as drawn, from the field, an element it is drawn in, or both, and every copy of a frame whole', async () => {
    document.body.innerHTML = `
      <div id="below" style="-webkit-box-reflect: below 20px"><input id="card" autocomplete="cc-number"></div>
      <input id="pw" type="password" style="-webkit-box-reflect: right 10%">
      <div id="above" style="-webkit-box-reflect: above 5px"><div id="left" style="-webkit-box-reflect: left 0px"><input id="otp" autocomplete="one-time-code"></div></div>
      <div id="framed" style="-webkit-box-reflect: below 10px"><iframe id="form" style="border: 0" srcdoc="<div id='inner' style='-webkit-box-reflect: below 4px'><input id='pw' type='password'></div>"></iframe></div>
      <iframe id="ads" src="https://ads.example.test/" style="-webkit-box-reflect: right 0px"></iframe>`;
    await framesLoad();
    // Laid out 95 by 20 and drawn at twice that, so its 20 px offset draws 40.
    place(document.getElementById('below')!, 0, 0, 190, 40);
    Object.defineProperty(document.getElementById('below')!, 'offsetWidth', { configurable: true, value: 95 });
    Object.defineProperty(document.getElementById('below')!, 'offsetHeight', { configurable: true, value: 20 });
    place(document.getElementById('card')!, 0, 0, 190, 40);
    place(document.getElementById('pw')!, 300, 0, 100, 20);
    place(document.getElementById('above')!, 0, 200, 200, 100);
    place(document.getElementById('left')!, 50, 220, 100, 40);
    place(document.getElementById('otp')!, 60, 230, 50, 20);
    place(document.getElementById('framed')!, 0, 400, 200, 100);
    place(document.getElementById('form')!, 0, 400, 200, 100);
    place(frameDoc('form').getElementById('inner')!, 0, 0, 200, 30);
    place(frameDoc('form').getElementById('pw')!, 10, 5, 50, 20);
    place(document.getElementById('ads')!, 300, 400, 300, 50);
    const found = secretBoxes();
    expect(found.secrets).toEqual([
      // Its copy starts 40 px below its box: the 20 px offset, drawn at twice its size.
      { x: 0, y: 0, width: 190, height: 40 }, { x: 0, y: 80, width: 190, height: 40 },
      // 10% of its 100 px width beyond its right edge.
      { x: 300, y: 0, width: 100, height: 20 }, { x: 410, y: 0, width: 100, height: 20 },
      // Left of its inner box's left edge, above its outer box's top edge, and the outer's copy of the inner's copy.
      { x: 60, y: 230, width: 50, height: 20 }, { x: -10, y: 230, width: 50, height: 20 }, { x: 60, y: 145, width: 50, height: 20 }, { x: -10, y: 145, width: 50, height: 20 },
      // In a same-origin frame, its copy placed through the frame as the field is.
      { x: 10, y: 405, width: 50, height: 20 }, { x: 10, y: 439, width: 50, height: 20 },
    ]);
    // The frames' copies, whole: the same-origin one under its reflected parent, and another site's.
    expect(found.mirroredFrames).toEqual([{ x: 0, y: 510, width: 200, height: 100 }, { x: 600, y: 400, width: 300, height: 50 }]);
    expect(found.otherSiteFrames).toEqual([{ x: 300, y: 400, width: 300, height: 50 }]);
    // Every screenshot blacks out the frames' copies, whatever its read of the frames finds.
    expect(screenshotMasks(found, ['https://ads.example.test/'], 2)).toEqual([...found.secrets, ...found.mirroredFrames]);
  });

  it('blacks out the whole view for a reflected secret field whose copy it can\'t place: under a turned reflection, at an offset it can\'t read, or past MAX_MIRRORS copies', async () => {
    const view = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    const cases: Array<[string, string]> = [
      ['turned', '<div id="r" style="transform: rotate(10deg); -webkit-box-reflect: below 0px"><input id="pw" type="password"></div>'],
      ['unread offset', '<div id="r" style="-webkit-box-reflect: below calc(10px + 5%)"><input id="pw" type="password"></div>'],
      ['six deep', `${'<div style="-webkit-box-reflect: below 0px">'.repeat(6)}<input id="pw" type="password">${'</div>'.repeat(6)}`],
    ];
    for (const [name, html] of cases) {
      document.body.innerHTML = html;
      document.querySelectorAll('div').forEach((el) => place(el, 0, 0, 200, 40));
      place(document.getElementById('pw')!, 10, 10, 100, 20);
      expect(secretBoxes().secrets, name).toEqual([{ x: 10, y: 10, width: 100, height: 20 }, view]);
    }
    // Five deep, 31 copies, each placed.
    document.body.innerHTML = `${'<div style="-webkit-box-reflect: below 0px">'.repeat(5)}<input id="pw" type="password">${'</div>'.repeat(5)}`;
    document.querySelectorAll('div').forEach((el) => place(el, 0, 0, 200, 40));
    place(document.getElementById('pw')!, 10, 10, 100, 20);
    expect(secretBoxes().secrets).toHaveLength(32);
  });

  it("counts the frame owners in every document it searches, and masks a same-origin frame past its depth as one it can't search", async () => {
    document.body.innerHTML = `
      <iframe id="outer" srcdoc="<iframe id='mid' srcdoc='<p>Deep</p>'></iframe>"></iframe>
      <svg><iframe></iframe></svg>
      <embed id="emb" src="https://shop.other.test/buy" type="text/html">`;
    await framesLoad();
    await framesLoad();
    place(document.getElementById('outer')!, 10, 10, 300, 100);
    place(frameDoc('outer').getElementById('mid')!, 5, 5, 50, 20);
    place(document.getElementById('emb')!, 10, 120, 300, 100);
    const found = secretBoxes(1);
    // The two iframes; an SVG element named iframe and an embed hold no frame it can count.
    expect(found.owners).toBe(2);
    expect(found.otherSiteFrames).toEqual([{ x: 15, y: 15, width: 50, height: 20 }, { x: 10, y: 120, width: 300, height: 100 }]);
  });

  it("takes no screenshot when the frame tree holds a payment frame and the searched documents hold a frame their owners don't account for", () => {
    const found: FoundSecrets = { secrets: [{ x: 1, y: 1, width: 5, height: 5 }], paymentFrames: [], otherSiteFrames: [{ x: 0, y: 0, width: 50, height: 50 }], mirroredFrames: [], owners: 1, viewport: { width: 800, height: 600 } };
    const stripe = 'https://js.stripe.com/v3/elements-inner-card';
    // A payment frame in a closed shadow root, or behind an embed: two frames placed in the searched documents, one owner found.
    expect(screenshotMasks(found, ['https://ads.example.test/', stripe], 2)).toBeNull();
    // More owners than frames is a count off too.
    expect(screenshotMasks(found, [stripe], 0)).toBeNull();
    // No payment frame anywhere: the screenshot goes ahead.
    expect(screenshotMasks(found, ['https://ads.example.test/', 'https://ads.example.test/2'], 2)).toEqual(found.secrets);
    // Every frame placed: what can't be accounted for is blacked out.
    expect(screenshotMasks(found, [stripe], 1)).toEqual([...found.secrets, ...found.otherSiteFrames]);
  });
});

describe('the page answer', () => {
  const raw = (over: Partial<RawSnapshot>): RawSnapshot => ({
    url: 'https://news.example.test/article', title: 'Article', scroll: { y: 0, height: 900, viewport: 800 }, elements: [],
    text: '', truncated: false, frameOwners: [], nestedOwners: [], frames: [], boxes: [], viewport: { width: 1600, height: 800 }, ...over,
  });

  it("lists a frame inside a frame the read read that the frame's DOM doesn't place, as one in a closed shadow root there, by the frame tree, unread and with no box", () => {
    const panel = { url: 'https://news.example.test/panel', read: true as const, box: { x: 0, y: 0, width: 400, height: 300 }, at: { x: 0, y: 0 }, offscreen: false, elements: [], text: 'Embedded account panel', truncated: false };
    const owners = { frameOwners: [{ url: panel.url, visible: true, framed: true }], nestedOwners: [{ url: 'https://other.test/radios', visible: true, framed: true }] };
    const answer = pageAnswer(raw({ ...owners, frames: [panel] }), [], [panel.url], ['https://other.test/radios', 'https://other.test/sealed']);
    expect(answer.frames.slice(1)).toEqual([{ url: 'https://other.test/sealed', read: false, box: null }]);
    // Every frame there placed: none more.
    expect(pageAnswer(raw({ ...owners, frames: [panel] }), [], [panel.url], ['https://other.test/radios']).frames).toHaveLength(1);
  });

  it("puts each frame's box in screenshot pixels and its address as origin and path, or a scheme alone", () => {
    const answer = pageAnswer(raw({
      frameOwners: [{ url: 'https://forms.example.test/newsletter?u=ada', visible: true, framed: true }, { url: 'data:text/html,hi', visible: true, framed: true }],
      frames: [
        { url: 'https://forms.example.test/newsletter?u=ada#top', read: true, box: { x: 160, y: 300.4, width: 875, height: 280 }, at: { x: 160, y: 300.4 }, offscreen: false, elements: [{ role: 'button', name: 'Subscribe' }], text: 'Get the weekly digest.', truncated: false },
        { url: 'data:text/html,hi', read: false, box: { x: 0, y: 1600, width: 160, height: 160 }, at: { x: 0, y: 1600 }, offscreen: true },
      ],
    }), [], ['https://forms.example.test/newsletter?u=ada', 'data:text/html,hi'], []);
    expect(answer.frames).toEqual([
      { url: 'https://forms.example.test/newsletter', read: true, box: { x: 102, y: 192, width: 561, height: 180 }, at: { x: 160, y: 300 }, elements: [{ role: 'button', name: 'Subscribe' }], text: 'Get the weekly digest.', truncated: false },
      { url: 'data:', read: false, box: { x: 0, y: 1024, width: 103, height: 103 }, at: { x: 0, y: 1600 }, offscreen: true },
    ]);
    expect(problems(pageShape, answer)).toEqual([]);
  });

  it('rounds a frame box outward to whole screenshot pixels, so every point a click can land on in the frame is inside it', () => {
    // 1536 CSS pixels in a 1024-pixel screenshot: 1.5 CSS pixels a screenshot pixel.
    const answer = pageAnswer(raw({
      viewport: { width: 1536, height: 900 },
      frames: [{ url: 'https://shop.other.test/buy', read: false, box: { x: 150.6, y: 75.3, width: 300, height: 150 }, at: { x: 150.6, y: 75.3 }, offscreen: false }],
    }), [], [], []);
    // CSS x 150.6 to 450.6 is screenshot x 100.4 to 300.4: an integer click at 300 lands at CSS 450, in the frame.
    expect(answer.frames).toEqual([{ url: 'https://shop.other.test/buy', read: false, box: { x: 100, y: 50, width: 201, height: 101 }, at: { x: 151, y: 75 } }]);
  });

  it("gives each placed frame its at in whole CSS pixels, unscaled, and none to a frame it can't place", () => {
    const answer = pageAnswer(raw({
      viewport: { width: 1536, height: 900 },
      frameOwners: [{ url: 'https://shop.other.test/buy', visible: true, framed: true }],
      frames: [{ url: 'https://shop.other.test/buy', read: false, box: { x: 150.6, y: 75.3, width: 300, height: 150 }, at: { x: 150.6, y: 1275.3 }, offscreen: false }],
    }), [], ['https://shop.other.test/buy', 'https://js.stripe.com/v3/x'], []);
    expect(answer.frames).toEqual([
      { url: 'https://shop.other.test/buy', read: false, box: { x: 100, y: 50, width: 201, height: 101 }, at: { x: 151, y: 1275 } },
      { url: 'https://js.stripe.com/v3/x', read: false, box: null },
    ]);
    expect(problems(pageShape, answer)).toEqual([]);
  });

  it("lists a frame the page's DOM doesn't place, as one in a closed shadow root, unread and with no box", () => {
    const answer = pageAnswer(raw({ frameOwners: [{ url: 'https://ads.example.test/', visible: true, framed: true }] }), [], ['https://ads.example.test/', 'https://js.stripe.com/v3/x', 'about:srcdoc'], []);
    expect(answer.frames).toEqual([
      { url: 'https://js.stripe.com/v3/x', read: false, box: null },
      { url: 'about:srcdoc', read: false, box: null },
    ]);
  });

  it('counts only the owners that hold a frame, so an SVG iframe, an embed or an object showing no page offsets no frame the DOM leaves unplaced', () => {
    document.body.innerHTML = `
      <svg><iframe id="svg"></iframe></svg>
      <embed id="emb" src="https://shop.other.test/buy" type="text/html">
      <object id="img" data="https://shop.other.test/logo.png" type="image/png"></object>
      <iframe id="real" src="https://ads.example.test/"></iframe>`;
    const raw = snapshot(freshWorld());
    expect(raw.frameOwners.map((owner) => owner.framed)).toEqual([false, false, false, true]);
    // The frame tree: the iframe's, the embed's, and one in a closed shadow root.
    const answer = pageAnswer(raw, [], ['https://ads.example.test/', 'https://shop.other.test/buy', 'https://pay.other.test/'], []);
    expect(answer.frames).toEqual([
      { url: 'https://shop.other.test/buy', read: false, box: null },
      { url: 'https://pay.other.test/', read: false, box: null },
    ]);
  });

  it('holds every frame the frame tree shows unplaced when it shows fewer frames than the DOM holds', () => {
    const answer = pageAnswer(raw({
      frameOwners: [{ url: 'https://ads.example.test/', visible: true, framed: true }, { url: 'https://pay.other.test/', visible: true, framed: true }],
    }), [], ['https://ads.example.test/'], []);
    expect(answer.frames).toEqual([{ url: 'https://ads.example.test/', read: false, box: null }]);
  });

  it("never passes on a check frame's content", () => {
    const answer = pageAnswer(raw({
      frameOwners: [{ url: 'https://challenges.cloudflare.com/x', visible: true, framed: true }],
      frames: [{ url: 'https://challenges.cloudflare.com/x', read: true, box: { x: 0, y: 0, width: 300, height: 65 }, at: { x: 0, y: 0 }, offscreen: false, elements: [{ role: 'checkbox', name: 'Verify you are human' }], text: 'Verify', truncated: false }],
    }), [], ['https://challenges.cloudflare.com/x'], []);
    expect(answer.frames).toEqual([{ url: 'https://challenges.cloudflare.com/x', read: false, box: { x: 0, y: 0, width: 192, height: 42 }, at: { x: 0, y: 0 } }]);
  });

  it.each([
    ['https://js.stripe.com/v3/x', 'https://js.stripe.com/v3/x'],
    ['https://user:pw@forms.example.test:8443/a/b?q=1#h', 'https://forms.example.test:8443/a/b'],
    ['about:srcdoc', 'about:srcdoc'],
    ['about:blank', 'about:blank'],
    ['about:blank#top', 'about:blank'],
    // An owner with no src shows about:blank.
    ['', 'about:blank'],
    ['about:version', 'about:'],
    ['not an address', ''],
    ['data:text/html,<p>hi</p>', 'data:'],
    ['blob:https://a.test/0f3c', 'blob:'],
  ])('writes the frame address %s as %s', (address, written) => {
    expect(frameAddress(address)).toBe(written);
  });

  it.each([
    ['https://js.stripe.com/v3/x', true],
    ['https://m.stripe.network/x', false],
    ['https://STRIPE.com./x', true],
    ['https://notstripe.com/x', false],
    ['https://www.paypal.com/x', true],
    ['https://pay.google.com/x', true],
    ['https://google.com/x', false],
    ['about:blank', false],
  ])('%s is a payment frame: %s', (address, payment) => {
    expect(isPaymentAddress(address)).toBe(payment);
  });
});

describe("the step's change watch", () => {
  /* happy-dom holds each observer's record hook only by a WeakRef, so a
     garbage collection between two tasks can drop it. Each test therefore
     changes the page in the task that started the watch, and reads the
     records it queued with changeMark's takeRecords. */
  function watchedStep(token = 1): { world: PageWorldState; mark: (at?: { x: number; y: number } | null) => ChangeMark | null } {
    const world = freshWorld();
    expect(pageWorld(document, world, { kind: 'changeStart', token })).toEqual({ ok: true });
    watching.push(world);
    return { world, mark: (at = null) => pageWorld(document, world, { kind: 'changeMark', token, at }) as ChangeMark | null };
  }

  afterEach(() => vi.restoreAllMocks());

  it('counts what the step changes, and a style change moves no quiet clock', () => {
    document.body.innerHTML = '<div data-box id="box">Before</div><ul id="list"></ul>';
    layout();
    let clock = 1_000;
    vi.spyOn(window.performance, 'now').mockImplementation(() => clock);
    const { mark } = watchedStep();
    expect(mark()).toEqual({ changes: 0, sinceLastMs: 0, busy: false, opaque: false });
    clock = 1_040;
    document.getElementById('box')!.setAttribute('style', 'color: red');
    expect(mark()).toMatchObject({ changes: 1, sinceLastMs: 40 });
    clock = 1_050;
    document.getElementById('list')!.append(document.createElement('li'));
    document.getElementById('box')!.firstChild!.textContent = 'After';
    expect(mark()).toMatchObject({ changes: 3, sinceLastMs: 0 });
    clock = 1_080;
    expect(mark()).toMatchObject({ changes: 3, sinceLastMs: 30 });
  });

  it('counts a scroll, an input, a change and a toggle, and not a focus', () => {
    document.body.innerHTML = '<input data-box id="field"><div data-box id="pane"></div><details data-box id="more"></details>';
    layout();
    const { mark } = watchedStep();
    (document.getElementById('field') as HTMLInputElement).focus();
    expect(mark()!.changes).toBe(0);
    // A scroll inside a box doesn't bubble; the watch hears it on the way down.
    document.getElementById('pane')!.dispatchEvent(new Event('scroll'));
    document.getElementById('field')!.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('field')!.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('more')!.dispatchEvent(new Event('toggle'));
    expect(mark()!.changes).toBe(4);
  });

  it('watches open shadow roots, one added during the step too', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<p>Inside</p>';
    const { mark } = watchedStep();
    root.querySelector('p')!.firstChild!.textContent = 'Changed';
    expect(mark()!.changes).toBe(1);
    const later = document.createElement('div');
    later.attachShadow({ mode: 'open' }).innerHTML = '<p>Late</p>';
    document.body.append(later);
    expect(mark()!.changes).toBe(2);
    later.shadowRoot!.querySelector('p')!.firstChild!.textContent = 'Later still';
    expect(mark()!.changes).toBe(3);
  });

  it("answers can't tell for another step's token, and stops for good at changeStop", () => {
    document.body.innerHTML = '<p id="p">Text</p>';
    const { world, mark } = watchedStep(4);
    expect(pageWorld(document, world, { kind: 'changeMark', token: 3, at: null })).toBeNull();
    pageWorld(document, world, { kind: 'changeStop', token: 3 });
    expect(mark()).not.toBeNull();
    pageWorld(document, world, { kind: 'changeStop', token: 4 });
    document.getElementById('p')!.textContent = 'Changed';
    expect(mark()).toBeNull();
    expect(world.change).toBeNull();
  });

  it('tells a busy page, and one whose change it may not see: a frame, a canvas or a video in view, or a custom element with no open root under the step', () => {
    document.body.innerHTML = '<div data-box id="busy" aria-busy="true">Loading</div>';
    layout();
    expect(watchedStep().mark()).toMatchObject({ busy: true, opaque: false });
    for (const tag of ['iframe', 'canvas', 'video']) {
      document.body.innerHTML = `<${tag} id="thing"></${tag}><${tag} id="below"></${tag}>`;
      place(document.getElementById('thing')!, 10, 10, 200, 100);
      place(document.getElementById('below')!, 10, window.innerHeight + 50, 200, 100);
      expect(watchedStep().mark(), tag).toMatchObject({ busy: false, opaque: true });
      document.getElementById('thing')!.remove();
      expect(watchedStep().mark(), `${tag} out of view`).toMatchObject({ opaque: false });
    }
    document.body.innerHTML = '<pay-button id="sealed">Pay</pay-button><button id="plain">Go</button>';
    const restore = hitTestBy((x) => document.getElementById(x < 50 ? 'sealed' : 'plain'));
    try {
      expect(watchedStep().mark({ x: 10, y: 10 })).toMatchObject({ opaque: true });
      expect(watchedStep().mark({ x: 60, y: 10 })).toMatchObject({ opaque: false });
    } finally {
      restore();
    }
  });
});

describe('challenges', () => {
  it.each([
    ['https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x', 'cloudflare'],
    ['https://www.google.com/recaptcha/api2/anchor?k=x&size=normal', 'recaptcha'],
    ['https://www.recaptcha.net/recaptcha/api2/bframe', 'recaptcha'],
    ['https://newassets.hcaptcha.com/captcha/v1/x', 'hcaptcha'],
    ['https://client-api.arkoselabs.com/fc/x', 'arkose'],
    ['https://geo.captcha-delivery.com/captcha/', 'datadome'],
    ['https://www.google.com/recaptcha/api2/anchor?k=x&size=invisible', null],
    ['https://www.google.com/maps', null],
    ['http://challenges.cloudflare.com/x', null],
    ['not a url', null],
  ])('%s is %s', (address, kind) => {
    expect(challengeKind(address)).toBe(kind);
  });

  const CF = 'https://challenges.cloudflare.com/cdn-cgi/x';

  it('reports a check frame the page shows', () => {
    expect(challengesFrom([CF], [{ url: CF, visible: true, framed: true }])).toEqual([{ host: 'challenges.cloudflare.com', kind: 'cloudflare' }]);
  });

  it('never reports a hidden one', () => {
    expect(challengesFrom([CF], [{ url: CF, visible: false, framed: true }])).toEqual([]);
  });

  it('counts a check frame the DOM has no element for by its presence alone', () => {
    expect(challengesFrom([CF], [])).toEqual([{ host: 'challenges.cloudflare.com', kind: 'cloudflare' }]);
  });

  it('lists each host once and skips other frames', () => {
    const frames = [CF, `${CF}/2`, 'https://ads.example.test/', 'about:blank'];
    expect(challengesFrom(frames, [{ url: CF, visible: true, framed: true }])).toHaveLength(1);
    expect(challengesFrom(['https://ads.example.test/'], [])).toEqual([]);
  });
});
