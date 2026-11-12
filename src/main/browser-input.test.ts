import { describe, expect, it, vi } from 'vitest';
import { BridgeError, parseStepRequest, STEP_TIMEOUT_MS, type StepRequest } from '../shared/browser-contract';
import {
  AgentInput,
  ALLOWED_CDP_METHODS,
  type CdpDebugger,
  KEYED_CHARS,
  type Pacing,
  parseKeyCombo,
  type PageReader,
  runStep,
  type StepHost,
  withAgentInput,
} from './browser-input';
import type { HitTestResult, LocateResult, TypingFocus } from './browser-page-script';

const pacing: Pacing = { sleep: async () => {}, random: () => 0.5 };

function fakeDebugger() {
  let attached = false;
  const sent: Array<[string, Record<string, unknown>]> = [];
  const dbg: CdpDebugger & { sent: typeof sent; attaches: number; detaches: number } = {
    sent,
    attaches: 0,
    detaches: 0,
    attach: vi.fn(() => {
      attached = true;
      dbg.attaches += 1;
    }),
    detach: vi.fn(() => {
      attached = false;
      dbg.detaches += 1;
    }),
    isAttached: () => attached,
    sendCommand: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (!attached) throw new Error('not attached');
      sent.push([method, params ?? {}]);
      return {};
    }),
  };
  return dbg;
}

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

function host(over: Partial<PageReader> = {}, stepPacing: Pacing = pacing) {
  const dbg = fakeDebugger();
  const page: PageReader = {
    locate: vi.fn(async () => located()),
    focusedSecret: vi.fn(async () => false),
    typingFocus: vi.fn(async (): Promise<TypingFocus> => ({ secret: false, inField: true })),
    focusField: vi.fn(async () => ({ ok: true as const, selected: true })),
    focus: vi.fn(async () => ({ ok: true as const })),
    select: vi.fn(async () => ({ ok: true as const, chosen: ['x'] })),
    viewport: vi.fn(async () => VIEWPORT),
    hitTest: vi.fn(async (): Promise<HitTestResult> => ({ found: true, reaches: 0, intoFrame: false })),
    intoFrame: vi.fn(async () => false),
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

const events = (sent: Array<[string, Record<string, unknown>]>, method: string) =>
  sent.filter(([m]) => m === method).map(([, p]) => p);

/* The text each typed key put in, in order. */
const typedText = (sent: Array<[string, Record<string, unknown>]>) =>
  events(sent, 'Input.dispatchKeyEvent').filter((e) => e.type === 'keyDown').map((e) => e.text).join('');

/* The focus a type step finds before each key: it moves to a secret field
   once `moved` says so, as when the page or a typed line break moves it. */
const focusMovesToSecretWhen = (moved: () => boolean) => vi.fn(async (): Promise<TypingFocus> => ({ secret: moved(), inField: !moved() }));

/* The same, with the focus moving to an ordinary element outside the field. */
const focusLeavesWhen = (moved: () => boolean) => vi.fn(async (): Promise<TypingFocus> => ({ secret: false, inField: !moved() }));

describe('withAgentInput', () => {
  it('attaches for one step, sends only allowed methods and detaches', async () => {
    const dbg = fakeDebugger();
    await withAgentInput(dbg, { x: 0, y: 0 }, pacing, (input) => input.click({ x: 10, y: 10 }, 'left', 1));
    expect(dbg.attaches).toBe(1);
    expect(dbg.detaches).toBe(1);
    expect(dbg.sent.length).toBeGreaterThan(3);
    expect(dbg.sent.every(([method]) => ALLOWED_CDP_METHODS.has(method))).toBe(true);
    expect(dbg.sent[0]).toEqual(['Emulation.setFocusEmulationEnabled', { enabled: true }]);
  });

  it('detaches after a failure too', async () => {
    const dbg = fakeDebugger();
    await expect(withAgentInput(dbg, { x: 0, y: 0 }, pacing, async () => {
      throw new BridgeError('stale_element', 'gone');
    })).rejects.toMatchObject({ code: 'stale_element' });
    expect(dbg.isAttached()).toBe(false);
    expect(dbg.detaches).toBe(1);
  });

  it('refuses a method outside the allow-list before it reaches the debugger', async () => {
    const dbg = fakeDebugger();
    const sneaky = async (input: AgentInput) => {
      const send = (input as unknown as { send: (m: string, p: object) => Promise<unknown> }).send;
      await send('Runtime.evaluate', { expression: '1' });
    };
    await expect(withAgentInput(dbg, { x: 0, y: 0 }, pacing, sneaky)).rejects.toThrow(/refused to send Runtime.evaluate/);
    expect(dbg.sent.map(([m]) => m)).not.toContain('Runtime.evaluate');
    expect(dbg.isAttached()).toBe(false);
  });

  it('refuses a step while something else holds the debugger', async () => {
    const dbg = fakeDebugger();
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
    const { dbg, stepHost } = host({ typingFocus: vi.fn(async () => ({ secret: true, inField: false })) });
    await expect(runStep(stepHost, step({ action: 'type', element: 2, text: 'x' }))).rejects.toMatchObject({ code: 'password_field' });
    expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
  });

  it('clears and types nothing when the page moves the focus away as the field takes it', async () => {
    const { dbg, page, stepHost } = host({ typingFocus: vi.fn(async () => ({ secret: false, inField: false })) });
    await expect(runStep(stepHost, step({ action: 'type', element: 2, text: 'shoes' }))).rejects.toMatchObject({ code: 'stale_element', status: 409 });
    expect(page.typingFocus).toHaveBeenCalledWith(2);
    expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
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
    const { dbg, stepHost } = host({ focusedSecret: vi.fn(async () => true) });
    await runStep(stepHost, step({ action: 'press', key }));
    expect(events(dbg.sent, 'Input.dispatchKeyEvent').length).toBeGreaterThan(0);
  });

  it.each(['a', 'Backspace', 'Delete', ' ', 'Control+x', 'Meta+a'])('refuses %s while a secret field has focus, since it edits text', async (key) => {
    const { dbg, stepHost } = host({ focusedSecret: vi.fn(async () => true) });
    await expect(runStep(stepHost, step({ action: 'press', key }))).rejects.toMatchObject({ code: 'password_field', status: 403 });
    expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
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
    const hitTest = vi.fn(async (): Promise<HitTestResult> => ({ found: true, reaches: -1, intoFrame: false }));
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
    const { dbg, stepHost } = host({ hitTest: vi.fn(async (): Promise<HitTestResult> => ({ found: true, reaches: -1, intoFrame: true })) });
    await expect(runStep(stepHost, step({ action: 'click', element: 7 }))).rejects.toMatchObject({
      code: 'stale_element',
      status: 409,
      message: "element 7 holds a frame, or a part of the page this browser can't read, where a click by number would land; click inside it by position from a screenshot",
    });
    expect(events(dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed')).toEqual([]);
  });

  it('checks the point of a click by number again just before each press, and presses nothing once a frame moved over it', async () => {
    // The point reaches the element before the pointer moves, and a frame covers it once the pointer arrives.
    const hitTest = vi.fn()
      .mockResolvedValueOnce({ found: true, reaches: 0, intoFrame: false } satisfies HitTestResult)
      .mockResolvedValue({ found: true, reaches: -1, intoFrame: true } satisfies HitTestResult);
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
      .mockResolvedValueOnce({ found: true, reaches: 0, intoFrame: false } satisfies HitTestResult)
      .mockResolvedValue({ found: true, reaches: -1, intoFrame: false } satisfies HitTestResult);
    const { dbg, stepHost } = host({ hitTest, intoFrame: vi.fn(async () => true) });
    await expect(runStep(stepHost, step({ action: 'click', element: 7 }))).rejects.toMatchObject({
      message: 'a frame moved over element 7 as the pointer arrived, so nothing was pressed; read the page again',
    });
    expect(events(dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed')).toEqual([]);
  });

  it("checks again before a double click's second press, and stops there once something moved over the point", async () => {
    const hitTest = vi.fn()
      .mockResolvedValueOnce({ found: true, reaches: 0, intoFrame: false } satisfies HitTestResult)
      .mockResolvedValueOnce({ found: true, reaches: 0, intoFrame: false } satisfies HitTestResult)
      .mockResolvedValue({ found: true, reaches: -1, intoFrame: false } satisfies HitTestResult);
    const { dbg, stepHost } = host({ hitTest });
    await expect(runStep(stepHost, step({ action: 'click', element: 7, clicks: 2 }))).rejects.toMatchObject({
      code: 'stale_element',
      message: 'another element moved over element 7 as the pointer arrived, so nothing was pressed; read the page again',
    });
    expect(events(dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed').map((e) => e.clickCount)).toEqual([1]);
  });

  it('presses nothing for a click or a drag by position once a frame moved under the point since the step began, and presses into one that was there all along', async () => {
    const arrives = host({ intoFrame: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true) });
    await expect(runStep(arrives.stepHost, step({ action: 'click', x: 400, y: 300, coords: 'page' }))).rejects.toMatchObject({
      code: 'stale_element',
      status: 409,
      message: 'a frame moved under the point (400, 300) as the pointer arrived, so nothing was pressed; read the page again',
    });
    expect(arrives.page.intoFrame).toHaveBeenCalledWith({ x: 400, y: 300 });
    expect(events(arrives.dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed')).toEqual([]);
    const dragged = host({ intoFrame: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true) });
    await expect(runStep(dragged.stepHost, step({ action: 'drag', from: { x: 400, y: 300 }, to: { x: 600, y: 300 }, coords: 'page' }))).rejects.toMatchObject({ code: 'stale_element' });
    expect(events(dragged.dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed')).toEqual([]);
    // A frame under the point from the start is what the step was asked to click.
    const there = host({ intoFrame: vi.fn(async () => true) });
    await runStep(there.stepHost, step({ action: 'click', x: 400, y: 300, coords: 'page' }));
    expect(events(there.dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed')).toHaveLength(1);
  });

  it('checks the element a drag starts on again just before the press', async () => {
    const hitTest = vi.fn()
      .mockResolvedValueOnce({ found: true, reaches: 0, intoFrame: false } satisfies HitTestResult)
      .mockResolvedValue({ found: true, reaches: -1, intoFrame: true } satisfies HitTestResult);
    const { dbg, stepHost } = host({ hitTest });
    await expect(runStep(stepHost, step({ action: 'drag', from: { element: 5 }, to: { x: 600, y: 300 }, coords: 'page' }))).rejects.toMatchObject({ code: 'stale_element' });
    expect(events(dbg.sent, 'Input.dispatchMouseEvent').filter((e) => e.type === 'mousePressed')).toEqual([]);
  });

  it('presses the first point that reaches the element, and refuses one gone by then as stale', async () => {
    const { dbg, stepHost } = host({ hitTest: vi.fn(async () => ({ found: true as const, reaches: 3, intoFrame: false })) });
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
