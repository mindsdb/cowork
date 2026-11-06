import { describe, expect, it, vi } from 'vitest';
import { BridgeError, parseStepRequest, type StepRequest } from '../shared/browser-contract';
import {
  AgentInput,
  ALLOWED_CDP_METHODS,
  type CdpDebugger,
  type Pacing,
  parseKeyCombo,
  type PageReader,
  runStep,
  type StepHost,
  withAgentInput,
} from './browser-input';
import type { LocateResult } from './browser-page-script';

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

function host(over: Partial<PageReader> = {}) {
  const dbg = fakeDebugger();
  const page: PageReader = {
    locate: vi.fn(async () => located()),
    focusedSecret: vi.fn(async () => false),
    selectContents: vi.fn(async () => true),
    select: vi.fn(async () => ({ ok: true as const, chosen: ['x'] })),
    viewport: vi.fn(async () => VIEWPORT),
    ...over,
  };
  const nav = { load: vi.fn(async () => {}), back: vi.fn(async () => {}), forward: vi.fn(async () => {}), reload: vi.fn(async () => {}) };
  const stepHost: StepHost = {
    page,
    nav,
    pacing,
    withInput: async (run) => (await withAgentInput(dbg, { x: 0, y: 0 }, pacing, run)).result,
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
    const { dbg, stepHost } = host();
    await runStep(stepHost, step({ action: 'type', element: 2, text: 'Hi é', submit: true }));
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
    const { dbg, stepHost } = host({ locate: vi.fn(async () => located({ secret: true })) });
    await expect(runStep(stepHost, step({ action: 'type', element: 3, text: 'hunter2' }))).rejects.toMatchObject({ code: 'password_field', status: 403 });
    expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
    expect(events(dbg.sent, 'Input.insertText')).toEqual([]);
    expect(dbg.isAttached()).toBe(false);
  });

  it('refuses to type when the click lands focus in a secret field', async () => {
    const { dbg, stepHost } = host({ focusedSecret: vi.fn(async () => true) });
    await expect(runStep(stepHost, step({ action: 'type', element: 2, text: 'x' }))).rejects.toMatchObject({ code: 'password_field' });
    expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
  });

  it('refuses a key press while a secret field has focus', async () => {
    const { dbg, stepHost } = host({ focusedSecret: vi.fn(async () => true) });
    await expect(runStep(stepHost, step({ action: 'press', key: 'Enter' }))).rejects.toMatchObject({ code: 'password_field' });
    expect(events(dbg.sent, 'Input.dispatchKeyEvent')).toEqual([]);
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
    ['cmd+Enter', ['Meta'], 'Enter'],
    ['Control++', ['Control'], '+'],
    ['F5', [], 'F5'],
  ])('%s', (combo, modifiers, key) => {
    expect(parseKeyCombo(combo)).toMatchObject({ modifiers, key: { key } });
  });

  it.each(['Hyper+a', 'Control+Control+a', 'NotAKey'])('refuses %s', (combo) => {
    expect(parseKeyCombo(combo)).toBeNull();
  });

  it('runs a macOS shortcut as its editing command', async () => {
    const sent: Array<[string, Record<string, unknown>]> = [];
    const input = new AgentInput(async (m, p) => sent.push([m, p]), pacing, { x: 0, y: 0 }, 'darwin');
    await input.press(parseKeyCombo('Meta+a')!);
    expect(sent.find(([, p]) => p.key === 'a')?.[1]).toMatchObject({ commands: ['selectAll'], modifiers: 4 });
  });
});
