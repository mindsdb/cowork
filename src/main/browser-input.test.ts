import { describe, expect, it, vi } from 'vitest';
import { BridgeError, parseStepRequest, STEP_TIMEOUT_MS, type StepRequest } from '../shared/browser-contract';
import { type FakeCdpPage, type FakeFrame, fakeCdpDebugger, MAIN_FRAME, type SentCommand, sentOf } from '../../tests/browser-fake-cdp';
import { ALLOWED_CDP_METHODS, FRAME_READ_MS } from './browser-frames';
import {
  AgentInput,
  KEYED_CHARS,
  type Pacing,
  parseKeyCombo,
  type PageReader,
  runStep,
  type StepHost,
  withAgentInput,
} from './browser-input';
import type { FocusedSecret, HitTestResult, LocateResult, TypingFocus } from './browser-page-script';

const pacing: Pacing = { sleep: async () => {}, random: () => 0.5 };

const VIEWPORT = { width: 1600, height: 900 };

function located(over: Partial<Extract<LocateResult, { found: true }>> = {}): LocateResult {
  return {
    found: true,
    box: { x: 100, y: 100, width: 200, height: 40 },
    shown: true,
    inViewport: true,
    secret: false,
    disabled: false,
    tag: 'input',
    viewport: VIEWPORT,
    ...over,
  };
}

function host(over: Partial<PageReader> = {}, stepPacing: Pacing = pacing, cdp: Partial<FakeCdpPage> = {}) {
  const dbg = fakeCdpDebugger(cdp);
  const page: PageReader = {
    locate: vi.fn(async () => located()),
    focusedSecret: vi.fn(async () => ({ secret: false, otherSite: false, sealed: false })),
    typingFocus: vi.fn(async (): Promise<TypingFocus> => ({ secret: false, inField: true, inControl: false })),
    focusField: vi.fn(async () => ({ ok: true as const, selected: true })),
    focus: vi.fn(async () => ({ ok: true as const })),
    select: vi.fn(async () => ({ ok: true as const, chosen: ['x'] })),
    viewport: vi.fn(async () => VIEWPORT),
    hitTest: vi.fn(async (): Promise<HitTestResult> => ({ found: true, reaches: 0, throughFrame: -1 })),
    ...over,
  };
  const nav = { load: vi.fn(async () => {}), back: vi.fn(async () => {}), forward: vi.fn(async () => {}), reload: vi.fn(async () => {}) };
  const stepHost: StepHost = {
    page,
    nav,
    pacing: stepPacing,
    withInput: async (run) => (await withAgentInput(dbg, { x: 0, y: 0 }, stepPacing, run)).result,
  };
  return { dbg, page, nav, stepHost };
}

function step(body: Record<string, unknown>): StepRequest {
  const parsed = parseStepRequest(body);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

const events = (sent: SentCommand[], method: string) =>
  sent.filter(([m]) => m === method).map(([, p]) => p);

/* The text each typed key put in, in order. */
const typedText = (sent: SentCommand[]) =>
  events(sent, 'Input.dispatchKeyEvent').filter((e) => e.type === 'keyDown').map((e) => e.text).join('');

/* The focus a type step finds before each key: it moves to a secret field
   once `moved` says so, as when the page or a typed line break moves it. */
const focusMovesToSecretWhen = (moved: () => boolean) => vi.fn(async (): Promise<TypingFocus> => ({ secret: moved(), inField: !moved(), inControl: false }));

/* The same, with the focus moving to an ordinary element outside the field. */
const focusLeavesWhen = (moved: () => boolean) => vi.fn(async (): Promise<TypingFocus> => ({ secret: false, inField: !moved(), inControl: false }));

describe('withAgentInput', () => {
  it('attaches for one step, sends only allowed methods and detaches', async () => {
    const dbg = fakeCdpDebugger();
    await withAgentInput(dbg, { x: 0, y: 0 }, pacing, (input) => input.click({ x: 10, y: 10 }, 'left', 1));
    expect(dbg.attaches).toBe(1);
    expect(dbg.detaches).toBe(1);
    expect(dbg.sent.length).toBeGreaterThan(3);
    expect(dbg.sent.every(([method]) => ALLOWED_CDP_METHODS.has(method))).toBe(true);
    expect(dbg.sent[0]).toEqual(['Emulation.setFocusEmulationEnabled', { enabled: true }, undefined]);
  });

  it('detaches after a failure too', async () => {
    const dbg = fakeCdpDebugger();
    await expect(withAgentInput(dbg, { x: 0, y: 0 }, pacing, async () => {
      throw new BridgeError('stale_element', 'gone');
    })).rejects.toMatchObject({ code: 'stale_element' });
    expect(dbg.isAttached()).toBe(false);
    expect(dbg.detaches).toBe(1);
  });

  it('refuses a method outside the allow-list before it reaches the debugger', async () => {
    const dbg = fakeCdpDebugger();
    const sneaky = async (input: AgentInput) => {
      const send = (input as unknown as { send: (m: string, p: object) => Promise<unknown> }).send;
      await send('Runtime.evaluate', { expression: '1' });
    };
    await expect(withAgentInput(dbg, { x: 0, y: 0 }, pacing, sneaky)).rejects.toThrow(/refused to send Runtime.evaluate/);
    expect(dbg.sent.map(([m]) => m)).not.toContain('Runtime.evaluate');
    expect(dbg.isAttached()).toBe(false);
  });

  it('refuses a step while something else holds the debugger', async () => {
    const dbg = fakeCdpDebugger();
    dbg.attach();
    await expect(withAgentInput(dbg, { x: 0, y: 0 }, pacing, async () => {})).rejects.toMatchObject({ code: 'page_busy' });
  });
});

describe('runStep', () => {
  it('clicks inside the element after an eased path, with press and release', async () => {
    const { dbg, stepHost } = host();
    await runStep(stepHost, step({ action: 'click', element: 7 }));
    const mouse = events(dbg.sent, 'Input.dispatchMouseEvent');
    const moves = mouse.filter((e) => e.type === 'mouseMoved');
    expect(moves.length).toBeGreaterThanOrEqual(5);
    const pressed = mouse.find((e) => e.type === 'mousePressed')!;
    expect(pressed).toMatchObject({ button: 'left', clickCount: 1, buttons: 1 });
    expect(pressed.x).toBeGreaterThan(100);
    expect(pressed.x).toBeLessThan(300);
    expect(pressed.y).toBeGreaterThan(100);
    expect(pressed.y).toBeLessThan(140);
    expect(mouse.at(-1)).toMatchObject({ type: 'mouseReleased', clickCount: 1 });
  });

  it("refuses a middle click on Linux before it attaches, since it pastes the person's selection there", async () => {
    const linux = host();
    await expect(runStep(linux.stepHost, step({ action: 'click', element: 7, button: 'middle' }), 'linux')).rejects.toMatchObject({ code: 'bad_request', status: 400 });
    await expect(runStep(linux.stepHost, step({ action: 'click', x: 10, y: 10, button: 'middle' }), 'linux')).rejects.toMatchObject({ code: 'bad_request' });
    expect(linux.dbg.attaches).toBe(0);
    await runStep(linux.stepHost, step({ action: 'click', element: 7, button: 'right' }), 'linux');
    expect(linux.dbg.attaches).toBe(1);
    for (const platform of ['darwin', 'win32'] as const) {
      const { dbg, stepHost } = host();
      await runStep(stepHost, step({ action: 'click', element: 7, button: 'middle' }), platform);
      expect(events(dbg.sent, 'Input.dispatchMouseEvent').find((e) => e.type === 'mousePressed'), platform).toMatchObject({ button: 'middle' });
    }
  });

  it('double-clicks with click counts 1 and 2', async () => {
    const { dbg, stepHost } = host();
    await runStep(stepHost, step({ action: 'click', element: 7, clicks: 2 }));
    const presses = events(dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed');
    expect(presses.map((e) => e.clickCount)).toEqual([1, 2]);
  });

  it('scales a screenshot point back to the page', async () => {
    const { dbg, stepHost } = host();
    await runStep(stepHost, step({ action: 'click', x: 512, y: 100, coords: 'screenshot' }));
    const pressed = events(dbg.sent, 'Input.dispatchMouseEvent').find((e) => e.type === 'mousePressed')!;
    expect(pressed.x).toBeCloseTo(800);
    expect(pressed.y).toBeCloseTo(156.25);
  });

  it('types key by key, shift for capitals, and inserts what has no key', async () => {
    const { dbg, page, stepHost } = host();
    await runStep(stepHost, step({ action: 'type', element: 2, text: 'Hi é', submit: true }));
    expect(page.focusField).toHaveBeenCalledWith(2, true);
    const keys = events(dbg.sent, 'Input.dispatchKeyEvent');
    const typed = keys.filter((e) => e.type === 'keyDown').map((e) => e.text);
    expect(typed).toEqual(['H', 'i', ' ', '\r']);
    expect(keys.find((e) => e.text === 'H')).toMatchObject({ code: 'KeyH', modifiers: 8 });
    expect(keys.some((e) => e.type === 'rawKeyDown' && e.key === 'Shift')).toBe(true);
    expect(keys.filter((e) => e.type === 'keyUp').length).toBeGreaterThanOrEqual(4);
    expect(events(dbg.sent, 'Input.insertText')).toEqual([{ text: 'é' }]);
    // The field was cleared first: its contents selected, then Backspace.
    expect(keys.find((e) => e.key === 'Backspace')).toBeDefined();
  });

  it('refuses to type into a secret field and sends no keys', async () => {
    const { dbg, stepHost } = host({ focusField: vi.fn(async () => ({ ok: false as const, reason: 'secret' as const })) });
    await expect(runStep(stepHost, step({ action: 'type', element: 3, text: 'hunter2' }))).rejects.toMatchObject({ code: 'password_field', status: 403 });
    expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
    expect(events(dbg.sent, 'Input.insertText')).toEqual([]);
    expect(dbg.isAttached()).toBe(false);
  });

  it('refuses to type when the focus lands in a secret field', async () => {
    const { dbg, stepHost } = host({ typingFocus: vi.fn(async () => ({ secret: true, inField: false, inControl: false })) });
    await expect(runStep(stepHost, step({ action: 'type', element: 2, text: 'x' }))).rejects.toMatchObject({ code: 'password_field' });
    expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
  });

  it('clears and types nothing when the page moves the focus away as the field takes it', async () => {
    const { dbg, page, stepHost } = host({ typingFocus: vi.fn(async () => ({ secret: false, inField: false, inControl: false })) });
    await expect(runStep(stepHost, step({ action: 'type', element: 2, text: 'shoes' }))).rejects.toMatchObject({ code: 'stale_element', status: 409 });
    expect(page.typingFocus).toHaveBeenCalledWith(2);
    expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
  });

  it("types a type by number's spaces as inserted text while its field sits in a control a Space key clicks, read before each key, and keys them elsewhere", async () => {
    let keys = 0;
    const inButton = host({
      focusField: vi.fn(async () => ({ ok: true as const, selected: false })),
      typingFocus: vi.fn(async (): Promise<TypingFocus> => ({ secret: false, inField: true, inControl: keys++ > 1 })),
    });
    // The page moves the field into a button after its first two keys.
    await runStep(inButton.stepHost, step({ action: 'type', element: 2, text: 'a bc d', clear: false }));
    expect(typedText(inButton.dbg.sent)).toBe('a bcd');
    expect(events(inButton.dbg.sent, 'Input.insertText')).toEqual([{ text: ' ' }]);
    const plain = host();
    await runStep(plain.stepHost, step({ action: 'type', element: 2, text: 'a b', clear: false }));
    expect(typedText(plain.dbg.sent)).toBe('a b');
    expect(events(plain.dbg.sent, 'Input.insertText')).toEqual([]);
  });

  it('focuses the field instead of clicking it, so typing never clicks a control', async () => {
    const { dbg, page, stepHost } = host();
    await runStep(stepHost, step({ action: 'type', element: 7, text: 'x', clear: false }));
    expect(page.focusField).toHaveBeenCalledWith(7, false);
    expect(page.locate).not.toHaveBeenCalled();
    expect(events(dbg.sent, 'Input.dispatchMouseEvent')).toEqual([]);
    expect(typedText(dbg.sent)).toBe('x');
  });

  it('refuses to type into an element that is not a text field, or that takes no focus', async () => {
    const notText = host({ focusField: vi.fn(async () => ({ ok: false as const, reason: 'not_text' as const })) });
    await expect(runStep(notText.stepHost, step({ action: 'type', element: 7, text: ' ' }))).rejects.toMatchObject({ code: 'bad_request', message: 'element 7 is not a text field' });
    const hidden = host({ focusField: vi.fn(async () => ({ ok: false as const, reason: 'unfocusable' as const })) });
    await expect(runStep(hidden.stepHost, step({ action: 'type', element: 7, text: 'x' }))).rejects.toMatchObject({ code: 'stale_element' });
    expect([...notText.dbg.sent, ...hidden.dbg.sent].filter(([m]) => m !== 'Emulation.setFocusEmulationEnabled')).toEqual([]);
  });

  it('types a tab as text, never as the Tab key, so typing keeps the focus in its field', async () => {
    const { dbg, stepHost } = host();
    await runStep(stepHost, step({ action: 'type', element: 2, text: 'shoes\t ', clear: false }));
    expect(events(dbg.sent, 'Input.dispatchKeyEvent').some((e) => e.key === 'Tab')).toBe(false);
    expect(events(dbg.sent, 'Input.insertText')).toEqual([{ text: '\t' }]);
    expect(typedText(dbg.sent)).toBe('shoes ');
  });

  it('stops typing when a typed line break moves the focus into a secret field', async () => {
    const { dbg, stepHost } = host();
    stepHost.page.typingFocus = focusMovesToSecretWhen(() => typedText(dbg.sent).includes('\r'));
    await expect(runStep(stepHost, step({ action: 'type', element: 2, text: 'ada\nhunter2' }))).rejects.toMatchObject({ code: 'password_field', status: 403 });
    expect(typedText(dbg.sent)).toBe('ada\r');
  });

  it('stops typing when a typed line break moves the focus out of the field, as a search that opens a new page does', async () => {
    const { dbg, stepHost } = host();
    stepHost.page.typingFocus = focusLeavesWhen(() => typedText(dbg.sent).includes('\r'));
    await expect(runStep(stepHost, step({ action: 'type', element: 2, text: 'shoes\n buy' }))).rejects.toMatchObject({
      code: 'stale_element',
      status: 409,
      message: 'the focus left element 2, so the rest was not typed; read the page again',
    });
    expect(typedText(dbg.sent)).toBe('shoes\r');
  });

  it.each([
    ['a secret field', focusMovesToSecretWhen, 'password_field'],
    ['another element', focusLeavesWhen, 'stale_element'],
  ] as const)('checks the focus again before the submit Enter: the page moved it to %s', async (_where, moves, code) => {
    const { dbg, stepHost } = host();
    // The page moves the focus once the text is in.
    stepHost.page.typingFocus = moves(() => typedText(dbg.sent) === 'ada');
    await expect(runStep(stepHost, step({ action: 'type', element: 2, text: 'ada', clear: false, submit: true }))).rejects.toMatchObject({ code });
    expect(events(dbg.sent, 'Input.dispatchKeyEvent').some((e) => e.key === 'Enter')).toBe(false);
  });

  it('types a long text inside the step budget: the start key by key, the rest inserted', async () => {
    let elapsed = 0;
    // The longest pauses every time.
    const slowest: Pacing = { sleep: async (ms) => { elapsed += ms; }, random: () => 1 };
    const text = 'abcdefghij'.repeat(200);
    const { dbg, page, stepHost } = host({ focusField: vi.fn(async () => ({ ok: true as const, selected: false })) }, slowest);
    await runStep(stepHost, step({ action: 'type', element: 2, text }));
    /* The pauses take at most two thirds of a step's time, which leaves the
       rest for the page to answer the focus check before each key. */
    expect(elapsed).toBeLessThan((STEP_TIMEOUT_MS * 2) / 3);
    const inserted = events(dbg.sent, 'Input.insertText').map((e) => e.text);
    expect(typedText(dbg.sent)).toBe(text.slice(0, KEYED_CHARS));
    expect(inserted.every((chunk) => String(chunk).length <= 40)).toBe(true);
    expect(typedText(dbg.sent) + inserted.join('')).toBe(text);
    // The focus is checked before every key and every chunk.
    expect(page.typingFocus).toHaveBeenCalledTimes(KEYED_CHARS + inserted.length);
  });

  it.each([
    ['into a secret field', focusMovesToSecretWhen, 'password_field'],
    ['out of the field', focusLeavesWhen, 'stale_element'],
  ] as const)('stops inserting a long text when the focus moves %s', async (_where, moves, code) => {
    const { dbg, stepHost } = host();
    stepHost.page.typingFocus = moves(() => typedText(dbg.sent).length === KEYED_CHARS);
    await expect(runStep(stepHost, step({ action: 'type', element: 2, text: 'x'.repeat(KEYED_CHARS + 100) }))).rejects.toMatchObject({ code });
    expect(events(dbg.sent, 'Input.insertText')).toEqual([]);
  });

  it.each(['Enter', 'Tab', 'Shift+Tab', 'Escape', 'ArrowDown'])('presses %s while a secret field has focus, since it edits no text', async (key) => {
    const { dbg, stepHost } = host({ focusedSecret: vi.fn(async () => ({ secret: true, otherSite: false, sealed: false })) });
    await runStep(stepHost, step({ action: 'press', key }));
    expect(events(dbg.sent, 'Input.dispatchKeyEvent').length).toBeGreaterThan(0);
  });

  it.each(['a', 'Backspace', 'Delete', ' ', 'Control+x', 'Meta+a'])('refuses %s while a secret field has focus, since it edits text', async (key) => {
    const { dbg, stepHost } = host({ focusedSecret: vi.fn(async () => ({ secret: true, otherSite: false, sealed: false })) });
    await expect(runStep(stepHost, step({ action: 'press', key }))).rejects.toMatchObject({ code: 'password_field', status: 403 });
    expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
  });

  /* The page's world sees the focus rest on a frame of another site, which
     it can't read: the debugger reads the focus inside that frame. */
  const focusInFrame = { focusedSecret: vi.fn(async () => ({ secret: false, otherSite: true, sealed: false })) };
  const widget = (frame: Partial<FakeFrame> = {}): Partial<FakeCdpPage> => ({
    main: { focus: { secret: false, otherSite: true, sealed: false } },
    frames: [{ id: 'widget', url: 'https://login.other.test/embed', parentId: MAIN_FRAME, remote: true, ...frame }],
    focusedOwnerOf: 'widget',
  });

  it("reads the focus inside another site's frame in that frame's own world, and refuses an editing key only when it rests on a secret field there", async () => {
    const secret = host(focusInFrame, pacing, widget({ focus: { secret: true, otherSite: false, sealed: false } }));
    await expect(runStep(secret.stepHost, step({ action: 'press', key: 'a' }))).rejects.toMatchObject({ code: 'password_field', status: 403 });
    expect(events(secret.dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
    const plain = host(focusInFrame, pacing, widget({ focus: { secret: false, otherSite: false, sealed: false } }));
    await runStep(plain.stepHost, step({ action: 'press', key: 'a' }));
    expect(typedText(plain.dbg.sent)).toBe('a');
    // Read on the frame's own session, in a world made for the read; the page's own main frame names the frame first.
    const worlds = sentOf(plain.dbg, 'Page.createIsolatedWorld');
    expect(worlds.map(({ params, sessionId }) => [params.frameId, sessionId])).toEqual([[MAIN_FRAME, undefined], ['widget', 'session-widget']]);
    expect(worlds.every(({ params }) => !('grantUniveralAccess' in params))).toBe(true);
    expect(sentOf(plain.dbg, 'Runtime.evaluate').at(-1)).toMatchObject({ sessionId: 'session-widget', params: { returnByValue: true } });
  });

  it.each([
    ["a payment provider's frame, which is never read", widget({ url: 'https://js.stripe.com/v3/elements-inner-card' })],
    ['a frame of yet another site inside it', widget({ focus: { secret: false, otherSite: true, sealed: false } })],
    ['a frame the debugger finds no owner of', { ...widget(), focusedOwnerOf: null }],
  ])("refuses an editing key whose focus rests in %s, and still presses Enter there", async (_where, page) => {
    const refused = host(focusInFrame, pacing, page);
    await expect(runStep(refused.stepHost, step({ action: 'press', key: 'a' }))).rejects.toMatchObject({ code: 'password_field' });
    expect(events(refused.dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
    expect(sentOf(refused.dbg, 'Page.createIsolatedWorld').filter(({ params }) => String(params.frameId) !== MAIN_FRAME).every(({ params }) => params.frameId === 'widget')).toBe(true);
    if (page.frames?.[0]?.url.includes('stripe')) expect(sentOf(refused.dbg, 'Page.createIsolatedWorld').filter(({ params }) => params.frameId === 'widget')).toEqual([]);
    const enter = host(focusInFrame, pacing, page);
    await runStep(enter.stepHost, step({ action: 'press', key: 'Enter' }));
    expect(events(enter.dbg.sent, 'Input.dispatchKeyEvent').some((e) => e.key === 'Enter')).toBe(true);
  });

  it("refuses an editing key into another site's frame whose world doesn't answer in time", async () => {
    vi.useFakeTimers();
    try {
      const { dbg, stepHost } = host(focusInFrame, pacing, widget({ hangs: true }));
      const pressed = runStep(stepHost, step({ action: 'press', key: 'a' }));
      const outcome = expect(pressed).rejects.toMatchObject({ code: 'password_field' });
      await vi.advanceTimersByTimeAsync(FRAME_READ_MS);
      await outcome;
      expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  /* The page's world sees the focus stop on an element that may keep a
     closed shadow root, as it stops at a closed root's host: the debugger
     follows the focus inside. `closedRoots` is where it is in each one. */
  const focusSealed = { focusedSecret: vi.fn(async () => ({ secret: false, otherSite: false, sealed: true })) };
  const inRoot = (focus: Partial<FocusedSecret>): FocusedSecret => ({ secret: false, otherSite: false, sealed: false, ...focus });
  const sealedMain = (...closedRoots: Array<Partial<FocusedSecret>>): Partial<FakeCdpPage> => ({
    main: { focus: inRoot({ sealed: true }), closedRoots: closedRoots.map(inRoot) },
  });

  it('follows the focus into a closed shadow root through the debugger, refuses an editing key into a secret field there, and types into an ordinary one', async () => {
    const secret = host(focusSealed, pacing, sealedMain({ secret: true }));
    await expect(runStep(secret.stepHost, step({ action: 'press', key: 'a' }))).rejects.toMatchObject({ code: 'password_field', status: 403 });
    expect(events(secret.dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
    const plain = host(focusSealed, pacing, sealedMain({}));
    await runStep(plain.stepHost, step({ action: 'press', key: 'a' }));
    expect(typedText(plain.dbg.sent)).toBe('a');
    // The root goes to this browser's own world in the page, and the read inside it runs in that world, never on an object.
    const [{ params: world }] = sentOf(plain.dbg, 'Page.createIsolatedWorld');
    expect(world).toMatchObject({ frameId: MAIN_FRAME });
    const resolved = sentOf(plain.dbg, 'DOM.resolveNode');
    expect(resolved).toEqual([{ params: { backendNodeId: expect.any(Number), executionContextId: expect.any(Number) }, sessionId: undefined }]);
    const calls = sentOf(plain.dbg, 'Runtime.callFunctionOn');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(({ params }) => params.executionContextId === resolved[0].params.executionContextId && !('objectId' in params))).toBe(true);
    // Each node handed to the world goes back.
    expect(sentOf(plain.dbg, 'Runtime.releaseObject').map(({ params }) => params.objectId)).toEqual(expect.arrayContaining(['focus:main:0', 'root:main:0']));
  });

  const widgetInRoot = (frame: Partial<FakeFrame>): Partial<FakeCdpPage> => ({
    ...sealedMain({ otherSite: true }),
    frames: [{ id: 'widget', url: 'https://login.other.test/embed', parentId: MAIN_FRAME, remote: true, ...frame }],
    focusedOwnerOf: 'widget',
  });

  it.each([
    ['a secret field two closed roots deep', focusSealed, sealedMain({ sealed: true }, { secret: true })],
    ["the password field of another site's frame kept in a closed root", focusSealed, widgetInRoot({ focus: inRoot({ secret: true }) })],
    ["a secret field in a closed root inside another site's frame", focusInFrame, widget({ focus: inRoot({ sealed: true }), closedRoots: [inRoot({ secret: true })] })],
  ])('refuses an editing key into %s, and still presses Enter there', async (_where, page, cdp) => {
    const refused = host(page, pacing, cdp);
    await expect(runStep(refused.stepHost, step({ action: 'press', key: 'a' }))).rejects.toMatchObject({ code: 'password_field' });
    expect(events(refused.dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
    const enter = host(page, pacing, cdp);
    await runStep(enter.stepHost, step({ action: 'press', key: 'Enter' }));
    expect(events(enter.dbg.sent, 'Input.dispatchKeyEvent').some((e) => e.key === 'Enter')).toBe(true);
  });

  it("types into an ordinary field of another site's frame kept in a closed root, read in that frame's own world", async () => {
    const { dbg, stepHost } = host(focusSealed, pacing, widgetInRoot({ focus: inRoot({}) }));
    await runStep(stepHost, step({ action: 'press', key: 'a' }));
    expect(typedText(dbg.sent)).toBe('a');
    expect(sentOf(dbg, 'Runtime.evaluate').at(-1)).toMatchObject({ sessionId: 'session-widget', params: { expression: expect.stringContaining('"kind":"focusedSecret"') } });
  });

  it('types where the focus rests on an element that keeps no closed root, and reads nothing through the debugger for a focus the world sees all of', async () => {
    const sealed = host(focusSealed, pacing, sealedMain());
    await runStep(sealed.stepHost, step({ action: 'press', key: 'a' }));
    expect(typedText(sealed.dbg.sent)).toBe('a');
    expect(sentOf(sealed.dbg, 'DOM.resolveNode')).toEqual([]);
    const plain = host();
    await runStep(plain.stepHost, step({ action: 'press', key: 'a' }));
    expect(sentOf(plain.dbg, 'Page.createIsolatedWorld')).toEqual([]);
  });

  it("refuses an editing key into a closed root whose page doesn't answer in time", async () => {
    vi.useFakeTimers();
    try {
      const { dbg, stepHost } = host(focusSealed, pacing, { main: { hangs: true } });
      const pressed = runStep(stepHost, step({ action: 'press', key: 'a' }));
      const outcome = expect(pressed).rejects.toMatchObject({ code: 'password_field' });
      await vi.advanceTimersByTimeAsync(FRAME_READ_MS);
      await outcome;
      expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  /* A type with focused true: the model clicked a frame's field by pixel,
     which has no number, and types into whatever has the focus now. */
  const typeFocused = (text: string, submit = false) => step({ action: 'type', focused: true, text, submit });
  /* The reads of the focused text entry, on the session each ran on. */
  const entryReads = (dbg: ReturnType<typeof host>['dbg']) =>
    [...sentOf(dbg, 'Runtime.evaluate'), ...sentOf(dbg, 'Runtime.callFunctionOn')]
      .filter(({ params }) => String(params.expression ?? params.functionDeclaration).includes('"kind":"focusedEntry"'));

  it("types a focused type at the caret of an ordinary field in another site's frame, read in that frame's own world, clearing nothing", async () => {
    const { dbg, page, stepHost } = host({}, pacing, widget({ entry: 41 }));
    await runStep(stepHost, typeFocused('ada@exämple.test'));
    expect(typedText(dbg.sent)).toBe('ada@exmple.test');
    expect(events(dbg.sent, 'Input.insertText')).toEqual([{ text: 'ä' }]);
    // Nothing selected or deleted first, and no Enter without submit.
    expect(events(dbg.sent, 'Input.dispatchKeyEvent').some((e) => ['Backspace', 'Enter'].includes(String(e.key)) || e.modifiers !== 0 && e.key === 'a')).toBe(false);
    expect(page.focusField).not.toHaveBeenCalled();
    expect(page.focus).not.toHaveBeenCalled();
    expect(events(dbg.sent, 'Input.dispatchMouseEvent')).toEqual([]);
    // Read on the frame's own session before every key, the first one included.
    const reads = entryReads(dbg);
    expect(reads.length).toBeGreaterThan([...'ada@exämple.test'].length);
    expect(reads.every(({ sessionId }) => sessionId === 'session-widget')).toBe(true);
  });

  it('types a focused type into a field of the page itself, or one the focus rests on inside a closed root, and presses Enter after it only with submit', async () => {
    const plain = host({}, pacing, { main: { entry: 3 } });
    await runStep(plain.stepHost, typeFocused('shoes', true));
    expect(typedText(plain.dbg.sent)).toBe('shoes\r');
    expect(entryReads(plain.dbg).every(({ sessionId }) => sessionId === undefined)).toBe(true);
    const sealed = host({}, pacing, { main: { focus: inRoot({ sealed: true }), closedRoots: [inRoot({})], entry: 9 } });
    await runStep(sealed.stepHost, typeFocused('shoes'));
    expect(typedText(sealed.dbg.sent)).toBe('shoes');
    // The entry is read from inside the root the debugger handed the world.
    expect(sentOf(sealed.dbg, 'Runtime.callFunctionOn').some(({ params }) => String(params.functionDeclaration).includes('"kind":"focusedEntry"'))).toBe(true);
  });

  it("types a focused type's spaces as inserted text while its field sits in a control a Space key clicks, in another site's frame too", async () => {
    const { dbg, stepHost } = host({}, pacing, widget({ entry: 41, inControl: true }));
    await runStep(stepHost, typeFocused('a b'));
    expect(typedText(dbg.sent)).toBe('ab');
    expect(events(dbg.sent, 'Input.insertText')).toEqual([{ text: ' ' }]);
    const page = host({}, pacing, { main: { entry: 3, inControl: true } });
    await runStep(page.stepHost, typeFocused('a b'));
    expect(events(page.dbg.sent, 'Input.insertText')).toEqual([{ text: ' ' }]);
  });

  it.each([
    ['a secret field of the page', { main: { focus: inRoot({ secret: true }), entry: 3 } }],
    ["the password field of another site's frame", widget({ focus: inRoot({ secret: true }) })],
    ['a secret field in a closed root', sealedMain({ secret: true })],
    ["a secret field in a closed root inside another site's frame", widget({ focus: inRoot({ sealed: true }), closedRoots: [inRoot({ secret: true })] })],
    ['a field the page names for a card', { main: { cardNamed: true } }],
    ["a field named for a card in another site's frame", widget({ cardNamed: true })],
  ])('refuses a focused type onto %s as password_field, and types nothing', async (_where, cdp) => {
    const { dbg, stepHost } = host({}, pacing, cdp);
    await expect(runStep(stepHost, typeFocused('hunter2'))).rejects.toMatchObject({ code: 'password_field', status: 403 });
    expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
    expect(events(dbg.sent, 'Input.insertText')).toEqual([]);
  });

  it.each([
    ['a button of the page, or nothing at all', {}],
    ["a button in another site's frame", widget()],
    ['an element in a closed root that takes no text', sealedMain({})],
  ])('refuses a focused type onto %s as not_a_text_field, and types nothing', async (_where, cdp) => {
    const { dbg, stepHost } = host({}, pacing, cdp);
    await expect(runStep(stepHost, typeFocused('shoes'))).rejects.toMatchObject({ code: 'not_a_text_field', status: 409 });
    expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
    expect(events(dbg.sent, 'Input.insertText')).toEqual([]);
  });

  it.each([
    ["a payment provider's frame, which is never read", widget({ url: 'https://js.stripe.com/v3/elements-inner-card', entry: 4 })],
    ['a frame of yet another site inside it', widget({ focus: inRoot({ otherSite: true }), entry: 4 })],
    ['a frame the debugger finds no owner of', { ...widget({ entry: 4 }), focusedOwnerOf: null }],
    ['closed roots nested past what a read follows', { main: { focus: inRoot({ sealed: true }), closedRoots: Array.from({ length: 12 }, () => inRoot({ sealed: true })), entry: 4 } }],
  ])('refuses a focused type whose focus rests in %s as focus_unreadable, and types nothing', async (_where, cdp) => {
    const { dbg, stepHost } = host({}, pacing, cdp);
    await expect(runStep(stepHost, typeFocused('shoes'))).rejects.toMatchObject({ code: 'focus_unreadable', status: 409 });
    expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
    expect(events(dbg.sent, 'Input.insertText')).toEqual([]);
  });

  it("refuses a focused type into another site's frame whose world doesn't answer in time as focus_unreadable", async () => {
    vi.useFakeTimers();
    try {
      const { dbg, stepHost } = host({}, pacing, widget({ hangs: true }));
      const typed = runStep(stepHost, typeFocused('shoes'));
      const outcome = expect(typed).rejects.toMatchObject({ code: 'focus_unreadable' });
      await vi.advanceTimersByTimeAsync(FRAME_READ_MS);
      await outcome;
      expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  /* The page moves the focus in the frame once `after` keys are in: to
     `to`'s field, or onto a secret one. */
  function focusMovesInFrame(after: number, to: Partial<FakeFrame>) {
    const made = host({}, pacing, widget({ entry: 41 }));
    const frame = made.dbg.page.frames.find((f) => f.id === 'widget')!;
    const send = made.dbg.sendCommand;
    made.dbg.sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>, sessionId?: string) => {
      if (typedText(made.dbg.sent).length >= after) Object.assign(frame, to);
      return send(method, params, sessionId);
    });
    return made;
  }

  it.each([
    ['another field that takes text too', { entry: 42 }, 'stale_element'],
    ['an element that takes no text', { entry: undefined }, 'stale_element'],
    ['a secret field', { entry: undefined, focus: inRoot({ secret: true }) }, 'password_field'],
    ['a field named for a card', { entry: undefined, cardNamed: true }, 'password_field'],
  ] as const)('stops a focused type once the page moves the focus to %s', async (_where, to, code) => {
    const { dbg, stepHost } = focusMovesInFrame(3, to);
    await expect(runStep(stepHost, typeFocused('ada@example.test'))).rejects.toMatchObject({ code });
    expect(typedText(dbg.sent)).toBe('ada');
  });

  it('checks the focus again before the Enter a focused type submits with, and presses none once it moved', async () => {
    const { dbg, stepHost } = focusMovesInFrame(3, { entry: 42 });
    await expect(runStep(stepHost, typeFocused('ada', true))).rejects.toMatchObject({ code: 'stale_element' });
    expect(events(dbg.sent, 'Input.dispatchKeyEvent').some((e) => e.key === 'Enter')).toBe(false);
  });

  it('runs a focused type with into_frame false or missing, since it presses at no point', async () => {
    const { dbg, stepHost } = host({}, pacing, widget({ entry: 41 }));
    await runStep(stepHost, step({ action: 'type', focused: true, text: 'x', submit: false, into_frame: false }));
    expect(typedText(dbg.sent)).toBe('x');
  });

  it("focuses a press's element instead of clicking it, and leaves a secret one alone only for editing keys", async () => {
    const { dbg, page, stepHost } = host();
    await runStep(stepHost, step({ action: 'press', key: 'Enter', element: 4 }));
    expect(page.focus).toHaveBeenLastCalledWith(4, false);
    await runStep(stepHost, step({ action: 'press', key: 'Backspace', element: 4 }));
    expect(page.focus).toHaveBeenLastCalledWith(4, true);
    expect(page.locate).not.toHaveBeenCalled();
    expect(events(dbg.sent, 'Input.dispatchMouseEvent')).toEqual([]);
    const secret = host({ focus: vi.fn(async () => ({ ok: false as const, reason: 'secret' as const })) });
    await expect(runStep(secret.stepHost, step({ action: 'press', key: 'a', element: 4 }))).rejects.toMatchObject({ code: 'password_field', message: expect.stringContaining('element 4') });
    expect(events(secret.dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
  });

  it.each(['Meta+v', 'Control+v', 'Control+Shift+V', 'Meta+Shift+v', 'Shift+Insert'])("refuses %s: the agent never pastes the person's clipboard", async (key) => {
    const { dbg, stepHost } = host();
    await expect(runStep(stepHost, step({ action: 'press', key, element: 2 }))).rejects.toMatchObject({ code: 'bad_request' });
    expect(dbg.attaches).toBe(0);
  });

  it('sends no native key code, so a key the page leaves alone never reaches the app menu', async () => {
    const { dbg, stepHost } = host();
    await runStep(stepHost, step({ action: 'press', key: 'Control+w' }));
    await runStep(stepHost, step({ action: 'type', element: 2, text: 'Hi' }));
    const keys = events(dbg.sent, 'Input.dispatchKeyEvent');
    expect(keys.length).toBeGreaterThan(4);
    expect(keys.every((e) => !('nativeVirtualKeyCode' in e))).toBe(true);
  });

  it('presses a combination with its modifiers held', async () => {
    const { dbg, stepHost } = host();
    await runStep(stepHost, step({ action: 'press', key: 'Shift+Tab' }));
    const keys = events(dbg.sent, 'Input.dispatchKeyEvent').map((e) => `${e.type}:${e.key}:${e.modifiers}`);
    expect(keys).toEqual(['rawKeyDown:Shift:8', 'rawKeyDown:Tab:8', 'keyUp:Tab:8', 'keyUp:Shift:0']);
  });

  it('reports a missing element as stale and refuses an unknown key', async () => {
    const { stepHost } = host({ locate: vi.fn(async () => ({ found: false as const })) });
    await expect(runStep(stepHost, step({ action: 'click', element: 99 }))).rejects.toMatchObject({ code: 'stale_element', message: 'element 99 is no longer on the page' });
    await expect(runStep(host().stepHost, step({ action: 'press', key: 'Hyper+q' }))).rejects.toMatchObject({ code: 'bad_request' });
    await expect(runStep(host().stepHost, step({ action: 'press', key: 'Return' }))).rejects.toMatchObject({ code: 'bad_request', message: expect.stringContaining('KeyboardEvent.key') });
  });

  it('refuses a click by number when every point it would press lands on another element, and presses nothing', async () => {
    const hitTest = vi.fn(async (): Promise<HitTestResult> => ({ found: true, reaches: -1, throughFrame: -1 }));
    const { dbg, stepHost } = host({ hitTest });
    await expect(runStep(stepHost, step({ action: 'click', element: 7 }))).rejects.toMatchObject({
      code: 'stale_element',
      status: 409,
      message: 'element 7 is covered by another element, such as a dialog or banner; deal with that first, or take a screenshot',
    });
    expect(events(dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed')).toEqual([]);
    // The random point first, then the same fixed points out from the middle, all inside the box.
    const [, points] = hitTest.mock.calls[0] as unknown as [number, Array<{ x: number; y: number }>];
    expect(points).toHaveLength(10);
    expect(points[1]).toEqual({ x: 200, y: 120 });
    expect(points.every((p) => p.x > 100 && p.x < 300 && p.y > 100 && p.y < 140)).toBe(true);
  });

  it('refuses a click by number whose points land in a frame inside the element, says so, and presses nothing', async () => {
    const { dbg, stepHost } = host({ hitTest: vi.fn(async (): Promise<HitTestResult> => ({ found: true, reaches: -1, throughFrame: 0 })) });
    await expect(runStep(stepHost, step({ action: 'click', element: 7 }))).rejects.toMatchObject({
      code: 'stale_element',
      status: 409,
      message: "element 7 holds a frame, or a part of the page this browser can't read, where a click by number would land; click inside it by position from a screenshot",
    });
    expect(events(dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed')).toEqual([]);
  });

  /* A control that slots its own text over a frame laid in its closed shadow
     root: the page's world hit-tests to the host and finds the slotted text
     there, so it says every point reaches the control. The debugger's hit
     test sees inside the closed root and finds the frame. */
  const OTHER_SITE = [{ id: 'buy', url: 'https://shop.other.test/buy', parentId: MAIN_FRAME, remote: true }];
  const frameOwner = { frameId: MAIN_FRAME, localName: 'iframe', ownsFrame: 'buy' };
  const button = { frameId: MAIN_FRAME, localName: 'button' };
  const presses = (dbg: { sent: SentCommand[] }) =>
    events(dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed');

  /* Sets `seen.it` once the debugger is sent a mouse event of `type`, as the
     page sees the pointer arrive or the button go down. */
  function onMouse(dbg: ReturnType<typeof fakeCdpDebugger>, type: string): { it: boolean } {
    const seen = { it: false };
    const send = dbg.sendCommand;
    dbg.sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>, sessionId?: string) => {
      if (method === 'Input.dispatchMouseEvent' && params?.type === type) seen.it = true;
      return send(method, params, sessionId);
    });
    return seen;
  }
  const mouse = (dbg: { sent: SentCommand[] }) => events(dbg.sent, 'Input.dispatchMouseEvent');

  it("refuses a click by number whose points the debugger's hit test finds in a frame, though the page's own says they reach the element, and presses nothing", async () => {
    const { dbg, stepHost } = host({}, pacing, { frames: OTHER_SITE, nodeAt: () => frameOwner });
    await expect(runStep(stepHost, step({ action: 'click', element: 7 }))).rejects.toMatchObject({
      code: 'stale_element',
      status: 409,
      message: "element 7 holds a frame, or a part of the page this browser can't read, where a click by number would land; click inside it by position from a screenshot",
    });
    expect(presses(dbg)).toEqual([]);
  });

  it('presses the first point of a click by number that the debugger finds outside a frame inside the element', async () => {
    // The frame covers the left half of the 200 by 40 box at (100, 100).
    const { dbg, stepHost } = host({}, pacing, { frames: OTHER_SITE, nodeAt: (x) => (x <= 200 ? frameOwner : button) });
    await runStep(stepHost, step({ action: 'click', element: 7 }));
    // The random point and the middle are (200, 120), then (150, 120), then (250, 120).
    expect(presses(dbg)).toEqual([expect.objectContaining({ x: 250, y: 120 })]);
  });

  it("hit-tests in the page's coordinates, and counts a node of another frame's document, or a point it can't read, as a frame", async () => {
    const scrolled = host({}, pacing, { scroll: { x: 0, y: 500 } });
    await runStep(scrolled.stepHost, step({ action: 'click', element: 7 }));
    expect(sentOf(scrolled.dbg, 'DOM.getNodeForLocation')[0].params).toEqual({ x: 200, y: 620 });
    const sameOrigin = host({}, pacing, { frames: [{ id: 'same', url: 'https://a.test/inner', parentId: MAIN_FRAME }], nodeAt: () => ({ frameId: 'same', localName: 'button' }) });
    await expect(runStep(sameOrigin.stepHost, step({ action: 'click', element: 7 }))).rejects.toMatchObject({ message: expect.stringContaining('holds a frame') });
    const unread = host({}, pacing, { nodeAt: () => null });
    await expect(runStep(unread.stepHost, step({ action: 'click', element: 7 }))).rejects.toMatchObject({ message: expect.stringContaining('holds a frame') });
    expect([...presses(sameOrigin.dbg), ...presses(unread.dbg)]).toEqual([]);
  });

  it("checks the point of a click by number with the debugger again just before each press, and presses nothing once it finds a frame there", async () => {
    // The page's world says the point reaches the element throughout; a frame slides over it as the pointer glides.
    const { dbg, stepHost } = host({}, pacing, { frames: OTHER_SITE });
    const moved = onMouse(dbg, 'mouseMoved');
    dbg.page.nodeAt = () => (moved.it ? frameOwner : button);
    await expect(runStep(stepHost, step({ action: 'click', element: 7 }))).rejects.toMatchObject({
      code: 'stale_element',
      message: 'a frame moved over element 7 as the pointer arrived, so nothing was pressed; read the page again',
    });
    expect(presses(dbg)).toEqual([]);
  });

  it('checks the point of a click by number again just before each press, and presses nothing once a frame moved over it', async () => {
    // The point reaches the element before the pointer moves, and a frame covers it once the pointer arrives.
    const hitTest = vi.fn()
      .mockResolvedValueOnce({ found: true, reaches: 0, throughFrame: -1 } satisfies HitTestResult)
      .mockResolvedValue({ found: true, reaches: -1, throughFrame: 0 } satisfies HitTestResult);
    const { dbg, stepHost } = host({ hitTest });
    await expect(runStep(stepHost, step({ action: 'click', element: 7 }))).rejects.toMatchObject({
      code: 'stale_element',
      status: 409,
      message: 'a frame moved over element 7 as the pointer arrived, so nothing was pressed; read the page again',
    });
    expect(events(dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed')).toEqual([]);
    // The check before the press asks about the one point the press lands on.
    const [, [pressed]] = hitTest.mock.calls[0] as [number, Array<{ x: number; y: number }>];
    expect(hitTest.mock.calls[1]).toEqual([7, [pressed]]);
    expect(events(dbg.sent, 'Input.dispatchMouseEvent').at(-1)).toMatchObject({ type: 'mouseMoved', ...pressed });
  });

  it('names a frame laid over the element from outside it as a frame when the check before the press finds one', async () => {
    const hitTest = vi.fn()
      .mockResolvedValueOnce({ found: true, reaches: 0, throughFrame: -1 } satisfies HitTestResult)
      .mockResolvedValue({ found: true, reaches: -1, throughFrame: -1 } satisfies HitTestResult);
    const { dbg, stepHost } = host({ hitTest }, pacing, { frames: OTHER_SITE });
    const moved = onMouse(dbg, 'mouseMoved');
    dbg.page.nodeAt = () => (moved.it ? frameOwner : button);
    await expect(runStep(stepHost, step({ action: 'click', element: 7 }))).rejects.toMatchObject({
      message: 'a frame moved over element 7 as the pointer arrived, so nothing was pressed; read the page again',
    });
    expect(events(dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed')).toEqual([]);
  });

  it("checks again before a double click's second press, and stops there once something moved over the point", async () => {
    const hitTest = vi.fn()
      .mockResolvedValueOnce({ found: true, reaches: 0, throughFrame: -1 } satisfies HitTestResult)
      .mockResolvedValueOnce({ found: true, reaches: 0, throughFrame: -1 } satisfies HitTestResult)
      .mockResolvedValue({ found: true, reaches: -1, throughFrame: -1 } satisfies HitTestResult);
    const { dbg, stepHost } = host({ hitTest });
    await expect(runStep(stepHost, step({ action: 'click', element: 7, clicks: 2 }))).rejects.toMatchObject({
      code: 'stale_element',
      message: 'another element moved over element 7 as the pointer arrived, so nothing was pressed; read the page again',
    });
    expect(events(dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed').map((e) => e.clickCount)).toEqual([1]);
  });

  it.each([
    ['without into_frame', {}],
    ['with into_frame false', { into_frame: false }],
  ])("refuses a click by position whose point lands in a frame when the step starts %s, and moves and presses nothing", async (_how, body) => {
    const { dbg, stepHost } = host({}, pacing, { frames: OTHER_SITE, nodeAt: () => frameOwner });
    await expect(runStep(stepHost, step({ action: 'click', x: 400, y: 300, coords: 'page', ...body }))).rejects.toMatchObject({
      code: 'stale_element',
      status: 409,
      message: "a frame is now under the point (400, 300), and the step wasn't approved to press into one, so nothing was pressed; read the page again",
    });
    expect(mouse(dbg)).toEqual([]);
  });

  it('presses into a frame under a click by position when anton sends into_frame, as the person approved', async () => {
    const { dbg, stepHost } = host({}, pacing, { frames: OTHER_SITE, nodeAt: () => frameOwner });
    await runStep(stepHost, step({ action: 'click', x: 400, y: 300, coords: 'page', into_frame: true }));
    expect(presses(dbg)).toEqual([expect.objectContaining({ x: 400, y: 300 })]);
  });

  it.each([
    ['without into_frame', {}],
    ['with into_frame', { into_frame: true }],
  ])('presses nothing for a click by position once a frame moves under the point as the pointer arrives, %s', async (_how, body) => {
    const { dbg, stepHost } = host({}, pacing, { frames: OTHER_SITE });
    const moved = onMouse(dbg, 'mouseMoved');
    dbg.page.nodeAt = () => (moved.it ? frameOwner : button);
    await expect(runStep(stepHost, step({ action: 'click', x: 400, y: 300, coords: 'page', ...body }))).rejects.toMatchObject({
      code: 'stale_element',
      message: 'a frame moved under the point (400, 300) as the pointer arrived, so nothing was pressed; read the page again',
    });
    expect(presses(dbg)).toEqual([]);
  });

  /* Two frames of other sites: one under the point when the step begins,
     which the person approved a press into, and another. */
  const TWO_SITES = [...OTHER_SITE, { id: 'video', url: 'https://video.other.test/embed', parentId: MAIN_FRAME, remote: true }];
  const videoOwner = { frameId: MAIN_FRAME, localName: 'iframe', ownsFrame: 'video' };
  const notTheFrame = (where: string) => `the frame under ${where} is no longer the one there when the step began, so nothing was pressed; read the page again`;

  it.each([
    ['another frame slides over the point', frameOwner],
    ['the frame moves away and the page lies under the point', button],
  ])('presses nothing with into_frame once %s as the pointer arrives', async (_how, after) => {
    const { dbg, stepHost } = host({}, pacing, { frames: TWO_SITES });
    const moved = onMouse(dbg, 'mouseMoved');
    dbg.page.nodeAt = () => (moved.it ? after : videoOwner);
    await expect(runStep(stepHost, step({ action: 'click', x: 400, y: 300, coords: 'page', into_frame: true }))).rejects.toMatchObject({
      code: 'stale_element',
      status: 409,
      message: notTheFrame('the point (400, 300)'),
    });
    expect(presses(dbg)).toEqual([]);
  });

  it('presses nothing with into_frame once the frame under the point navigated since the step began', async () => {
    const { dbg, stepHost } = host({}, pacing, { frames: TWO_SITES, nodeAt: () => videoOwner });
    const video = dbg.page.frames.find((frame) => frame.id === 'video')!;
    const send = dbg.sendCommand;
    dbg.sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>, sessionId?: string) => {
      if (method === 'Input.dispatchMouseEvent' && params?.type === 'mouseMoved') video.url = 'https://shop.other.test/checkout';
      return send(method, params, sessionId);
    });
    await expect(runStep(stepHost, step({ action: 'click', x: 400, y: 300, coords: 'page', into_frame: true }))).rejects.toMatchObject({
      code: 'stale_element',
      message: notTheFrame('the point (400, 300)'),
    });
    expect(presses(dbg)).toEqual([]);
  });

  it("presses nothing with into_frame where the debugger can't say which frame lies under the point, since nothing binds the press", async () => {
    const { dbg, stepHost } = host({}, pacing, { nodeAt: () => null });
    await expect(runStep(stepHost, step({ action: 'click', x: 400, y: 300, coords: 'page', into_frame: true }))).rejects.toMatchObject({
      code: 'stale_element',
      message: "this browser couldn't tell which frame lies under the point (400, 300), so nothing was pressed; read the page again",
    });
    expect(mouse(dbg)).toEqual([]);
  });

  it('lets go where a drag began, with into_frame, once another frame lies under the drop point than when the step began', async () => {
    const { dbg, stepHost } = host({}, pacing, { frames: TWO_SITES });
    const pressed = onMouse(dbg, 'mousePressed');
    dbg.page.nodeAt = (x) => (x >= 500 ? (pressed.it ? frameOwner : videoOwner) : button);
    await expect(runStep(stepHost, step({ action: 'drag', from: { x: 400, y: 300 }, to: { x: 600, y: 300 }, coords: 'page', into_frame: true }))).rejects.toMatchObject({
      code: 'stale_element',
      message: notTheFrame('the drop point (600, 300)'),
    });
    expect(mouse(dbg).filter((e) => e.type === 'mouseReleased')).toEqual([expect.objectContaining({ x: 400, y: 300, buttons: 0 })]);
  });

  it("checks a double click by position again before its second press, and stops there once a frame lies under the point", async () => {
    const { dbg, stepHost } = host({}, pacing, { frames: OTHER_SITE });
    const pressed = onMouse(dbg, 'mousePressed');
    dbg.page.nodeAt = () => (pressed.it ? frameOwner : button);
    await expect(runStep(stepHost, step({ action: 'click', x: 400, y: 300, coords: 'page', clicks: 2 }))).rejects.toMatchObject({ code: 'stale_element' });
    expect(presses(dbg).map((e) => e.clickCount)).toEqual([1]);
  });

  it("refuses a drag whose drop point lands in a frame when the step starts, unless anton sends into_frame, and presses nothing", async () => {
    const dropIntoFrame = (x: number) => (x >= 500 ? frameOwner : button);
    const drag = { action: 'drag', from: { x: 400, y: 300 }, to: { x: 600, y: 300 }, coords: 'page' };
    const refused = host({}, pacing, { frames: OTHER_SITE, nodeAt: dropIntoFrame });
    await expect(runStep(refused.stepHost, step(drag))).rejects.toMatchObject({
      code: 'stale_element',
      message: "a frame is now under the drop point (600, 300), and the step wasn't approved to press into one, so nothing was pressed; read the page again",
    });
    expect(presses(refused.dbg)).toEqual([]);
    const approved = host({}, pacing, { frames: OTHER_SITE, nodeAt: dropIntoFrame });
    await runStep(approved.stepHost, step({ ...drag, into_frame: true }));
    expect(mouse(approved.dbg).at(-1)).toMatchObject({ type: 'mouseReleased', x: 600, y: 300 });
  });

  it('checks the drop point again just before the release, and lets go where the drag began once a frame moved under it', async () => {
    const { dbg, stepHost } = host({}, pacing, { frames: OTHER_SITE });
    const pressed = onMouse(dbg, 'mousePressed');
    dbg.page.nodeAt = (x) => (pressed.it && x >= 500 ? frameOwner : button);
    await expect(runStep(stepHost, step({ action: 'drag', from: { x: 400, y: 300 }, to: { x: 600, y: 300 }, coords: 'page' }))).rejects.toMatchObject({
      code: 'stale_element',
      message: 'a frame moved under the drop point (600, 300) as the pointer arrived, so nothing was pressed; read the page again',
    });
    const released = mouse(dbg).filter((e) => e.type === 'mouseReleased');
    expect(released).toEqual([expect.objectContaining({ x: 400, y: 300, buttons: 0 })]);
  });

  it('checks the element a drag starts on again just before the press', async () => {
    const hitTest = vi.fn()
      .mockResolvedValueOnce({ found: true, reaches: 0, throughFrame: -1 } satisfies HitTestResult)
      .mockResolvedValue({ found: true, reaches: -1, throughFrame: 0 } satisfies HitTestResult);
    const { dbg, stepHost } = host({ hitTest });
    await expect(runStep(stepHost, step({ action: 'drag', from: { element: 5 }, to: { x: 600, y: 300 }, coords: 'page' }))).rejects.toMatchObject({ code: 'stale_element' });
    expect(events(dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed')).toEqual([]);
  });

  it('scrolls over a frame inside the element when every point lands in it, since a wheel there activates nothing, and a click there stays refused', async () => {
    const hitTest = vi.fn(async (): Promise<HitTestResult> => ({ found: true, reaches: -1, throughFrame: 2 }));
    const scrolled = host({ hitTest });
    await runStep(scrolled.stepHost, step({ action: 'scroll', element: 7, direction: 'down', amount: 240 }));
    const [, points] = hitTest.mock.calls[0] as unknown as [number, Array<{ x: number; y: number }>];
    const wheel = events(scrolled.dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mouseWheel');
    expect(wheel.length).toBeGreaterThan(0);
    expect(wheel.every((e) => e.x === points[2].x && e.y === points[2].y)).toBe(true);
    const clicked = host({ hitTest: vi.fn(async (): Promise<HitTestResult> => ({ found: true, reaches: -1, throughFrame: 2 })) });
    await expect(runStep(clicked.stepHost, step({ action: 'click', element: 7 }))).rejects.toMatchObject({ code: 'stale_element', message: expect.stringContaining('holds a frame') });
  });

  it('presses the first point that reaches the element, and refuses one gone by then as stale', async () => {
    const { dbg, stepHost } = host({ hitTest: vi.fn(async () => ({ found: true as const, reaches: 3, throughFrame: -1 })) });
    await runStep(stepHost, step({ action: 'click', element: 7 }));
    // Offset (0.25, 0) of the 200 by 40 box at (100, 100).
    expect(events(dbg.sent, 'Input.dispatchMouseEvent').find((e) => e.type === 'mousePressed')).toMatchObject({ x: 250, y: 120 });
    const gone = host({ hitTest: vi.fn(async () => ({ found: false as const })) });
    await expect(runStep(gone.stepHost, step({ action: 'click', element: 7 }))).rejects.toMatchObject({ code: 'stale_element', message: 'element 7 is no longer on the page' });
  });

  it('scrolls an element into view with wheel ticks before clicking it', async () => {
    const locate = vi.fn()
      .mockResolvedValueOnce(located({ box: { x: 100, y: 2000, width: 100, height: 30 }, inViewport: false }))
      .mockResolvedValue(located());
    const { dbg, stepHost } = host({ locate });
    await runStep(stepHost, step({ action: 'click', element: 4 }));
    const wheel = events(dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mouseWheel');
    expect(wheel.length).toBeGreaterThan(1);
    expect(wheel.reduce((sum, e) => sum + Number(e.deltaY), 0)).toBeCloseTo(2015 - 450);
    expect(locate).not.toHaveBeenCalledWith(4, true);
  });

  it('drags from an element to a point with the button held on the way', async () => {
    const { dbg, stepHost } = host();
    await runStep(stepHost, step({ action: 'drag', from: { element: 5 }, to: { x: 600, y: 300 }, coords: 'page' }));
    const mouse = events(dbg.sent, 'Input.dispatchMouseEvent');
    const pressAt = mouse.findIndex((e) => e.type === 'mousePressed');
    const releaseAt = mouse.findIndex((e) => e.type === 'mouseReleased');
    expect(mouse.slice(pressAt + 1, releaseAt).every((e) => e.type === 'mouseMoved' && e.buttons === 1)).toBe(true);
    expect(mouse[releaseAt]).toMatchObject({ x: 600, y: 300 });
  });

  it('selects without the debugger and navigates through the view', async () => {
    const { dbg, nav, page, stepHost } = host();
    await runStep(stepHost, step({ action: 'select', element: 6, value: 'Canada' }));
    expect(page.select).toHaveBeenCalledWith(6, ['Canada']);
    await runStep(stepHost, step({ action: 'navigate', url: 'https://example.test/' }));
    expect(nav.load).toHaveBeenCalledWith('https://example.test/');
    expect(dbg.attaches).toBe(0);
  });

  it('refuses a select into a secret field', async () => {
    const { stepHost } = host({ select: vi.fn(async () => ({ ok: false as const, reason: 'secret' as const })) });
    await expect(runStep(stepHost, step({ action: 'select', element: 12, value: '12' }))).rejects.toMatchObject({ code: 'password_field', status: 403, message: expect.stringContaining('element 12') });
  });

  it('explains a select with no such option', async () => {
    const { stepHost } = host({ select: vi.fn(async () => ({ ok: false as const, reason: 'no_option' as const, options: ['Mexico'] })) });
    await expect(runStep(stepHost, step({ action: 'select', element: 6, value: 'Peru' }))).rejects.toMatchObject({ code: 'bad_request', message: expect.stringContaining('Mexico') });
  });
});

describe('parseKeyCombo', () => {
  it.each([
    ['Enter', [], 'Enter'],
    ['a', [], 'a'],
    ['Control+a', ['Control'], 'a'],
    ['Meta+Enter', ['Meta'], 'Enter'],
    ['Control++', ['Control'], '+'],
    ['Shift+Tab', ['Shift'], 'Tab'],
    [' ', [], ' '],
    ['F5', [], 'F5'],
  ])('%s', (combo, modifiers, key) => {
    expect(parseKeyCombo(combo)).toMatchObject({ modifiers, key: { key } });
  });

  // The web pod's parseChord refuses these spellings too, except Control+Control+a, which only the desktop refuses.
  it.each([
    'Hyper+a', 'Control+Control+a', 'NotAKey', 'Return', 'Space', 'space', 'esc', 'enter', 'ctrl+a', 'cmd+Enter',
    'Control+ a', '\n', '\t', '+', 'Shift+', 'constructor', 'toString+a',
  ])('refuses %j', (combo) => {
    expect(parseKeyCombo(combo)).toBeNull();
  });

  it('runs a macOS shortcut as its editing command, and has none for paste', async () => {
    const sent: Array<[string, Record<string, unknown>]> = [];
    const input = new AgentInput(async (m, p) => sent.push([m, p]), pacing, { x: 0, y: 0 }, 'darwin');
    await input.press(parseKeyCombo('Meta+a')!);
    expect(sent.find(([, p]) => p.key === 'a')?.[1]).toMatchObject({ commands: ['selectAll'], modifiers: 4 });
    await input.press(parseKeyCombo('Meta+v')!);
    expect(sent.find(([, p]) => p.key === 'v')?.[1]).not.toHaveProperty('commands');
  });
});
