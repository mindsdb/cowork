// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pageShape, problems } from '../../tests/browser-contract-shapes';
import {
  challengeKind,
  challengesFrom,
  type FocusFieldResult,
  type FocusResult,
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
  ids: new Map(), byElement: new WeakMap(), next: 1, secret: new WeakSet(), observer: null, watched: new WeakSet(),
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

function snapshot(world: PageWorldState, maxText = 3000): RawSnapshot {
  return pageWorld(document, world, { kind: 'snapshot', maxText, maxElements: 300 }) as RawSnapshot;
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
  for (const world of watching.splice(0)) world.observer?.disconnect();
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
    const answer = pageAnswer(raw, challengesFrom(['https://challenges.cloudflare.com/cdn-cgi/x'], raw.frames));
    expect(problems(pageShape, answer)).toEqual([]);
    expect(answer.challenges).toEqual([{ host: 'challenges.cloudflare.com', kind: 'cloudflare' }]);
    expect(answer).not.toHaveProperty('boxes');
    expect(answer).not.toHaveProperty('frames');
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

  it('cuts the text at max_text and says so', () => {
    document.body.innerHTML = `<p>${'word '.repeat(100)}</p>`;
    const page = snapshot(freshWorld(), 50);
    expect(page.text).toHaveLength(50);
    expect(page.truncated).toBe(true);
  });

  it('lists frame elements and whether each one shows', () => {
    document.body.innerHTML = `
      <iframe id="cf" title="Widget containing a Cloudflare security challenge" src="https://challenges.cloudflare.com/cdn-cgi/x"></iframe>
      <iframe id="rc" src="https://www.google.com/recaptcha/api2/anchor?k=x"></iframe>`;
    place(document.getElementById('cf')!, 10, 10, 300, 65);
    place(document.getElementById('rc')!, 0, 0, 0, 0);
    const page = snapshot(freshWorld());
    expect(page.frames).toEqual([
      { url: 'https://challenges.cloudflare.com/cdn-cgi/x', visible: true },
      { url: 'https://www.google.com/recaptcha/api2/anchor?k=x', visible: false },
    ]);
    expect(page.elements).toEqual([{ id: 1, role: 'clickable', name: 'Widget containing a Cloudflare security challenge' }]);
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
    expect(pageWorld(document, world, { kind: 'focusedSecret' })).toEqual({ secret: false });
    (document.getElementById('pw') as HTMLInputElement).focus();
    expect(pageWorld(document, world, { kind: 'focusedSecret' })).toEqual({ secret: true });
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
    const read = () => new Function(`return ${pageWorldSource({ kind: 'snapshot', maxText: 100, maxElements: 300 })}`)() as RawSnapshot;
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
