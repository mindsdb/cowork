// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ELEMENTS_PER_FRAME, TEXT_PER_FRAME } from '../shared/browser-contract';
import { pageShape, problems } from '../../tests/browser-contract-shapes';
import {
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
  type FocusResult,
  type HitTestResult,
  type LocateResult,
  pageAnswer,
  pageWorld,
  pageWorldSource,
  type PageWorldState,
  type RawSnapshot,
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
  ids: new Map(), byElement: new WeakMap(), next: 1, secret: new WeakSet(), observer: null, watched: new WeakSet(), change: null,
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

/* The frames a read listed, by address. */
const framesByUrl = (page: RawSnapshot): Record<string, RawFrame> => Object.fromEntries(page.frames.map((f) => [f.url, f]));

/* happy-dom gives a text node no boxes, so each text node here takes its
   parent element's box, as Chromium gives a line of text its own. */
function textBoxesFromParents(): () => void {
  const original = document.createRange;
  document.createRange = () => {
    let node: Node | null = null;
    return {
      selectNodeContents: (target: Node) => { node = target; },
      getClientRects: () => {
        const box = node?.parentElement?.getBoundingClientRect();
        return box && (box.width || box.height) ? [box] : [];
      },
    } as unknown as Range;
  };
  return () => { document.createRange = original; };
}

/* happy-dom has no hit test, so each test says what lies at each point. */
function hitTestBy(at: (x: number, y: number) => Element | null): () => void {
  const original = document.elementFromPoint;
  document.elementFromPoint = at;
  return () => { document.elementFromPoint = original; };
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
    const answer = pageAnswer(raw, challengesFrom(frameUrls, raw.frameOwners), frameUrls);
    expect(problems(pageShape, answer)).toEqual([]);
    expect(answer.challenges).toEqual([{ host: 'challenges.cloudflare.com', kind: 'cloudflare' }]);
    expect(answer.frames).toEqual([{ url: 'https://challenges.cloudflare.com/cdn-cgi/x', read: false, box: { x: 10, y: 340, width: 300, height: 65 } }]);
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
      { url: 'https://challenges.cloudflare.com/cdn-cgi/x', visible: true },
      { url: 'https://www.google.com/recaptcha/api2/anchor?k=x', visible: false },
      { url: 'https://ads.example.test/', visible: true },
      { url: 'https://shop.other.test/buy', visible: true },
      { url: 'https://shop.other.test/buy', visible: true },
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
      expect(pageWorld(document, world, { kind: 'focusedSecret' }), id).toEqual({ secret: false, otherSite: true } satisfies FocusedSecret);
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
        pageWorld(document, world, { kind: 'hitTest', id, points: points.map(([x, y]) => ({ x, y })) });
      expect(hitTest(ids.Go, [[1, 1], [2, 2], [4, 4]])).toEqual({ found: true, reaches: 1, intoFrame: false } satisfies HitTestResult);
      expect(hitTest(ids.Go, [[4, 4]])).toEqual({ found: true, reaches: 0, intoFrame: false });
      expect(hitTest(ids.Agree, [[1, 1], [3, 3]])).toEqual({ found: true, reaches: 1, intoFrame: false });
      expect(hitTest(ids.Go, [[1, 1], [3, 3], [9, 9]])).toEqual({ found: true, reaches: -1, intoFrame: false });
      expect(hitTest(999, [[4, 4]])).toEqual({ found: false });
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
        pageWorld(document, world, { kind: 'hitTest', id, points: points.map(([x, y]) => ({ x, y })) });
      // Every point lands on another site's frame the control wraps, or its label holds.
      expect(hitTest(ids['More info'], [[1, 1]])).toEqual({ found: true, reaches: -1, intoFrame: true } satisfies HitTestResult);
      expect(hitTest(ids.Agree, [[2, 2]])).toEqual({ found: true, reaches: -1, intoFrame: true });
      // One in an open shadow root inside it, followed there.
      expect(hitTest(ids['Open widget'], [[3, 3]])).toEqual({ found: true, reaches: -1, intoFrame: true });
      // A custom element that shows no open shadow root and draws no text of its own there may hold a frame in a closed one.
      expect(hitTest(ids.Pay, [[4, 4]])).toEqual({ found: true, reaches: -1, intoFrame: true });
      // A point on the control itself still reaches it.
      expect(hitTest(ids['More info'], [[1, 1], [6, 6]])).toEqual({ found: true, reaches: 1, intoFrame: true });
    } finally {
      restoreHits();
    }
    // A custom element's own text, which a click there lands on, reaches its control.
    const restoreText = textBoxesFromParents();
    const restoreIcon = hitTestBy(() => document.getElementById('icon'));
    try {
      expect(pageWorld(document, world, { kind: 'hitTest', id: ids.Menu, points: [{ x: 15, y: 410 }] })).toEqual({ found: true, reaches: 0, intoFrame: false });
    } finally {
      restoreIcon();
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
    expect(pageWorld(document, world, { kind: 'focusedSecret' })).toEqual({ secret: false, otherSite: false });
    (document.getElementById('pw') as HTMLInputElement).focus();
    expect(pageWorld(document, world, { kind: 'focusedSecret' })).toEqual({ secret: true, otherSite: false });
  });

  it('tells a type step whether the focus is still in its field, and whether it is on a secret one', () => {
    document.body.innerHTML = SIGN_IN;
    layout();
    const world = freshWorld();
    const email = snapshot(world).elements.find((e) => e.name === 'Email')!;
    const typingFocus = () => pageWorld(document, world, { kind: 'typingFocus', id: email.id });
    (document.getElementById('email') as HTMLInputElement).focus();
    expect(typingFocus()).toEqual({ secret: false, inField: true } satisfies TypingFocus);
    (document.getElementById('go') as HTMLButtonElement).focus();
    expect(typingFocus()).toEqual({ secret: false, inField: false });
    (document.getElementById('pw') as HTMLInputElement).focus();
    expect(typingFocus()).toEqual({ secret: true, inField: false });
    document.getElementById('email')!.remove();
    expect(typingFocus()).toEqual({ secret: true, inField: false });
    expect(pageWorld(document, world, { kind: 'typingFocus', id: 999 })).toEqual({ secret: true, inField: false });
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
      { url: 'https://shop.other.test/buy', read: false, box: { x: 10, y: 10, width: 300, height: 100 }, offscreen: false },
      { url: 'about:srcdoc', read: false, box: { x: 10, y: 120, width: 300, height: 100 }, offscreen: false },
      { url: 'https://ads.example.test/', read: false, box: { x: 10, y: 230, width: 300, height: 100 }, offscreen: false },
    ]);
    expect(JSON.stringify(raw)).not.toContain('Readable');
    expect(pageAnswer(raw, [], []).frames.map((frame) => frame.box)).toEqual([
      { x: 10, y: 10, width: 300, height: 100 },
      { x: 10, y: 120, width: 300, height: 100 },
      { x: 10, y: 230, width: 300, height: 100 },
    ]);
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
    inner.querySelectorAll('input, textarea, [contenteditable], select, button').forEach((el, i) => place(el, 10, 10 + i * 30, 200, 20));
    // What the person typed, which no element of a frame carries.
    (inner.getElementById('note') as HTMLTextAreaElement).value = 'typed words';
    (inner.getElementById('email') as HTMLInputElement).value = 'ada@example.test';
    const world = freshWorld();
    const [frame] = snapshot(world).frames;
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
    expect(JSON.stringify(frame)).not.toMatch(/ada@example\.test|typed words/);
    expect(world.ids.size).toBe(0);
  });

  it('never reads a frame that holds a secret, card-named or sign-in field, sits on a payment or sign-in host, is a consent page, is under 32 px, or comes after the fifth read', async () => {
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
      ...[1, 2, 3, 4, 5, 6].map((n): [string, string, string] => [`plain${n}`, '', `<p>Plain ${n}</p>`]),
    ];
    document.body.innerHTML = frames.map(([id, src, body]) => `<iframe id="${id}"${src ? ` src="${src}"` : ''} srcdoc="${body}"></iframe>`).join('');
    await framesLoad();
    frames.forEach(([id], i) => place(document.getElementById(id)!, 0, i * 40, id === 'tiny' ? 400 : 300, id === 'tiny' ? 20 : 36));
    const page = snapshot(freshWorld());
    expect(page.frames.map((f) => f.read)).toEqual([...frames.slice(0, 9).map(() => false), true, true, true, true, true, false]);
    expect(JSON.stringify(page)).not.toMatch(/4242|Choose an account|Allow access|Card/);
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
    expect(pageWorld(document, world, { kind: 'focusedSecret' })).toEqual({ secret: true, otherSite: false } satisfies FocusedSecret);
    (frameDoc('login').getElementById('user') as HTMLInputElement).focus();
    expect(pageWorld(document, world, { kind: 'focusedSecret' })).toEqual({ secret: false, otherSite: false });
    document.getElementById('other')!.focus();
    expect(pageWorld(document, world, { kind: 'focusedSecret' })).toEqual({ secret: false, otherSite: true });
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
    const found = pageWorld(document, freshWorld(), { kind: 'secretBoxes', paymentHosts: [...FRAME_READ_RULES.paymentHosts] }) as FoundSecrets;
    expect(found.secrets).toEqual([
      { x: 10, y: 10, width: 100, height: 20 },
      { x: 10, y: 40, width: 100, height: 20 },
      { x: 60, y: 210, width: 80, height: 20 },
    ]);
    expect(found.paymentFrames).toEqual([{ x: 10, y: 320, width: 300, height: 40 }]);
    expect(found.otherSiteFrames).toEqual([{ x: 10, y: 320, width: 300, height: 40 }, { x: 10, y: 400, width: 300, height: 250 }]);
    // A payment frame the page's DOM accounts for hides itself alone.
    expect(screenshotMasks(found, ['https://js.stripe.com/v3/elements-inner-card', 'https://ads.example.test/'])).toEqual([...found.secrets, ...found.paymentFrames]);
    // One it doesn't (nested in another site's frame, or redirected there) hides every frame from another site.
    expect(screenshotMasks(found, ['https://js.stripe.com/v3/elements-inner-card', 'https://ads.example.test/', 'https://js.stripe.com/v3/controller.html'])).toEqual([...found.secrets, ...found.paymentFrames, ...found.otherSiteFrames]);
  });
});

describe('the page answer', () => {
  const raw = (over: Partial<RawSnapshot>): RawSnapshot => ({
    url: 'https://news.example.test/article', title: 'Article', scroll: { y: 0, height: 900, viewport: 800 }, elements: [],
    text: '', truncated: false, frameOwners: [], frames: [], boxes: [], viewport: { width: 1600, height: 800 }, ...over,
  });

  it("puts each frame's box in screenshot pixels and its address as origin and path, or a scheme alone", () => {
    const answer = pageAnswer(raw({
      frameOwners: [{ url: 'https://forms.example.test/newsletter?u=ada', visible: true }, { url: 'data:text/html,hi', visible: true }],
      frames: [
        { url: 'https://forms.example.test/newsletter?u=ada#top', read: true, box: { x: 160, y: 300.4, width: 875, height: 280 }, offscreen: false, elements: [{ role: 'button', name: 'Subscribe' }], text: 'Get the weekly digest.', truncated: false },
        { url: 'data:text/html,hi', read: false, box: { x: 0, y: 1600, width: 160, height: 160 }, offscreen: true },
      ],
    }), [], ['https://forms.example.test/newsletter?u=ada', 'data:text/html,hi']);
    expect(answer.frames).toEqual([
      { url: 'https://forms.example.test/newsletter', read: true, box: { x: 102, y: 192, width: 560, height: 179 }, elements: [{ role: 'button', name: 'Subscribe' }], text: 'Get the weekly digest.', truncated: false },
      { url: 'data:', read: false, box: { x: 0, y: 1024, width: 102, height: 102 }, offscreen: true },
    ]);
    expect(problems(pageShape, answer)).toEqual([]);
  });

  it("lists a frame the page's DOM doesn't place, as one in a closed shadow root, unread and with no box", () => {
    const answer = pageAnswer(raw({ frameOwners: [{ url: 'https://ads.example.test/', visible: true }] }), [], ['https://ads.example.test/', 'https://js.stripe.com/v3/x', 'about:srcdoc']);
    expect(answer.frames).toEqual([
      { url: 'https://js.stripe.com/v3/x', read: false, box: null },
      { url: 'about:srcdoc', read: false, box: null },
    ]);
  });

  it("never passes on a check frame's content", () => {
    const answer = pageAnswer(raw({
      frameOwners: [{ url: 'https://challenges.cloudflare.com/x', visible: true }],
      frames: [{ url: 'https://challenges.cloudflare.com/x', read: true, box: { x: 0, y: 0, width: 300, height: 65 }, offscreen: false, elements: [{ role: 'checkbox', name: 'Verify you are human' }], text: 'Verify', truncated: false }],
    }), [], ['https://challenges.cloudflare.com/x']);
    expect(answer.frames).toEqual([{ url: 'https://challenges.cloudflare.com/x', read: false, box: { x: 0, y: 0, width: 192, height: 42 } }]);
  });

  it.each([
    ['https://js.stripe.com/v3/x', 'https://js.stripe.com/v3/x'],
    ['https://user:pw@forms.example.test:8443/a/b?q=1#h', 'https://forms.example.test:8443/a/b'],
    ['about:srcdoc', 'about:srcdoc'],
    ['about:blank', 'about:blank'],
    ['', 'about:blank'],
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
    expect(challengesFrom([CF], [{ url: CF, visible: true }])).toEqual([{ host: 'challenges.cloudflare.com', kind: 'cloudflare' }]);
  });

  it('never reports a hidden one', () => {
    expect(challengesFrom([CF], [{ url: CF, visible: false }])).toEqual([]);
  });

  it('counts a check frame the DOM has no element for by its presence alone', () => {
    expect(challengesFrom([CF], [])).toEqual([{ host: 'challenges.cloudflare.com', kind: 'cloudflare' }]);
  });

  it('lists each host once and skips other frames', () => {
    const frames = [CF, `${CF}/2`, 'https://ads.example.test/', 'about:blank'];
    expect(challengesFrom(frames, [{ url: CF, visible: true }])).toHaveLength(1);
    expect(challengesFrom(['https://ads.example.test/'], [])).toEqual([]);
  });
});
