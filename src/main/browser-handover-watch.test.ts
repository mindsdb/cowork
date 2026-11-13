import { describe, expect, it } from 'vitest';
import type { PageElement, PageSnapshot } from '../shared/browser-contract';
import { parseControlRequest } from '../shared/browser-contract';
import { BrowserSessions, type PageReadOptions, type TabHooks, type TabView } from './browser-sessions';
import { pageChanged, pageKey, WATCH_IDLE_MS, WATCH_TICK_MS, waitForMet, type WatchRead } from './browser-handover-watch';
import type { HandbackElement } from './browser-page-script';

const page = (elements: PageElement[], url = 'https://united.test/minor'): PageSnapshot => ({
  url, title: 'T', scroll: { y: 0, height: 100, viewport: 100 }, elements, text: '', truncated: false, challenges: [], frames: [],
});
const box = (checked: boolean): PageElement => ({ id: 12, role: 'checkbox', name: "I've read and understood", checked });
/* A watch's read: the page, and the watched element's state as the page's world reads it. */
const read = (now: PageSnapshot, element: HandbackElement | null = null): WatchRead => ({ page: now, element });

describe('wait_for in POST /sessions/{id}/control', () => {
  it('takes an element state or a page change, and refuses anything else', () => {
    expect(parseControlRequest({ holder: 'human', reason: 'r', wait_for: { element: 12, state: 'checked' } }))
      .toEqual({ ok: true, value: { holder: 'human', reason: 'r', waitFor: { element: 12, state: 'checked' } } });
    expect(parseControlRequest({ holder: 'human', reason: 'r', wait_for: { page: 'changes' } }))
      .toEqual({ ok: true, value: { holder: 'human', reason: 'r', waitFor: { page: 'changes' } } });
    expect(parseControlRequest({ holder: 'human', reason: 'r', wait_for: null })).toEqual({ ok: true, value: { holder: 'human', reason: 'r' } });
    for (const bad of [{ element: -1, state: 'checked' }, { element: 1.5, state: 'filled' }, { element: 3, state: 'clicked' }, { page: 'loads' }, { page: 'changes', element: 3 }, 'checked']) {
      expect(parseControlRequest({ holder: 'human', reason: 'r', wait_for: bad })).toMatchObject({ ok: false });
    }
  });
});

describe('waitForMet', () => {
  it("reads a box as checked and a field as filled from the element's state in the page, never its value, and a page as changed", () => {
    expect(waitForMet({ element: 12, state: 'checked' }, page([box(false)]), read(page([box(true)]), { checked: true, filled: true }))).toBe(true);
    expect(waitForMet({ element: 12, state: 'checked' }, page([box(false)]), read(page([box(false)]), { checked: false, filled: false }))).toBe(false);
    const field = (value?: string): PageElement => ({ id: 4, role: 'textbox', name: 'Name', ...(value === undefined ? {} : { value }) });
    expect(waitForMet({ element: 4, state: 'filled' }, null, read(page([field('Ana')]), { checked: false, filled: true }))).toBe(true);
    expect(waitForMet({ element: 4, state: 'filled' }, null, read(page([field('  ')]), { checked: false, filled: false }))).toBe(false);
    // A secret field, a card's number among them, never carries its value, and its state still says it is filled.
    const card: PageElement = { id: 4, role: 'textbox', name: 'Card number', value_hidden: true };
    expect(waitForMet({ element: 4, state: 'filled' }, null, read(page([card]), { checked: false, filled: true }))).toBe(true);
    expect(waitForMet({ element: 4, state: 'filled' }, null, read(page([card]), { checked: false, filled: false }))).toBe(false);
    // Gone because the person moved on to another page: done; gone on the same page: not yet.
    expect(waitForMet({ element: 12, state: 'checked' }, page([box(false)]), read(page([], 'https://united.test/next')))).toBe(true);
    expect(waitForMet({ element: 12, state: 'checked' }, page([box(false)]), read(page([])))).toBe(false);
    expect(waitForMet({ page: 'changes' }, page([box(false)]), read(page([box(false)], 'https://united.test/next')))).toBe(true);
  });

  it('counts a page as changed only when its element list differs materially', () => {
    const els = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: i, role: 'link', name: `L${i + from}` }));
    expect(pageChanged(page(els(20)), page(els(20)))).toBe(false);
    expect(pageChanged(page(els(20)), page([...els(19), { id: 99, role: 'link', name: 'new' }]))).toBe(false);
    expect(pageChanged(page(els(20)), page(els(20, 5)))).toBe(true);
    expect(pageChanged(page(els(3)), page(els(3, 3)))).toBe(true);
  });

  it("never puts a value in what it compares, and counts the watched element's state", () => {
    expect(pageKey(read(page([{ id: 4, role: 'textbox', name: 'Name', value: 'secret-ish' }])))).not.toContain('secret-ish');
    const card = page([{ id: 4, role: 'textbox', name: 'Card number', value_hidden: true }]);
    expect(pageKey(read(card, { checked: false, filled: true }))).not.toBe(pageKey(read(card, { checked: false, filled: false })));
  });
});

function watched() {
  let clock = 1_000_000;
  let current = page([box(false)]);
  /* What the page's world reads of each element: a box's own checked state unless a test says otherwise. */
  let states: Record<number, HandbackElement> | null = null;
  const stateOf = (id: number): HandbackElement | null => {
    if (states) return states[id] ?? null;
    const el = current.elements.find((e) => e.id === id);
    return el ? { checked: el.checked === true, filled: el.checked === true || Boolean(el.value?.trim()) } : null;
  };
  const ticks: Array<() => void> = [];
  let stopped = 0;
  let hooks: TabHooks | null = null;
  const reads: Array<PageReadOptions | undefined> = [];
  let hold: Promise<void> | null = null;
  const view = {
    url: () => current.url, title: () => 'T', loading: () => false, canGoBack: () => false, canGoForward: () => false,
    read: async (_maxText: number, options?: PageReadOptions) => {
      reads.push(options);
      if (hold) await hold;
      return current;
    },
    handbackElement: async (id: number) => stateOf(id),
    act: async () => {}, screenshot: async () => ({ jpeg: Buffer.from(''), width: 1, height: 1 }),
    load: async () => {}, back: async () => {}, forward: async () => {}, reload: async () => {},
    show: () => {}, park: () => {}, abortInput: () => {}, watchSecrets: () => {}, close: () => {},
  } as unknown as TabView;
  const sessions = new BrowserSessions({
    factory: { create: (h) => { hooks = h; return view; } },
    emit: () => {},
    cookies: async () => ({ present: false, expiresAt: null }),
    now: () => clock,
    every: (tick) => { ticks.push(tick); return () => { stopped += 1; }; },
  });
  sessions.setAvailable(true);
  sessions.open('t-a', null);
  return {
    sessions,
    set: (next: PageSnapshot) => { current = next; },
    setStates: (next: Record<number, HandbackElement>) => { states = next; },
    input: () => hooks?.personInput(),
    advance: (ms: number) => { clock += ms; },
    ticks,
    stopped: () => stopped,
    reads,
    /* Holds every read until the returned function lets them go. */
    holdReads: () => {
      let release = () => {};
      hold = new Promise<void>((resolve) => { release = resolve; });
      return () => { hold = null; release(); };
    },
  };
}

describe('a hand-over that comes back by itself', () => {
  it('hands back as the person once the box is checked, the person is idle and the page settled', async () => {
    const w = watched();
    w.sessions.control('t-a', { holder: 'human', reason: 'Tick the policy box', waitFor: { element: 12, state: 'checked' } });
    expect(w.ticks).toHaveLength(1);
    expect(w.sessions.stateOf('t-a')?.watching).toBe(true);
    await w.sessions.tickWatches();
    w.advance(500);
    w.input();
    w.set(page([box(true)]));
    await w.sessions.tickWatches();
    w.advance(WATCH_TICK_MS);
    await w.sessions.tickWatches();
    // Checked and settled, but the person used the browser under 3 s ago.
    expect(w.sessions.info('t-a').control.holder).toBe('human');
    w.advance(WATCH_IDLE_MS);
    await w.sessions.tickWatches();
    expect(w.sessions.info('t-a').control).toMatchObject({ holder: 'agent', by: 'person', seq: 2 });
    expect(w.sessions.stateOf('t-a')?.watching).toBe(false);
    expect(w.stopped()).toBe(1);
  });

  it("hands back once the person fills a card field, whose value no read carries, as the page's world reads it filled", async () => {
    const w = watched();
    const card = page([{ id: 4, role: 'textbox', name: 'Card number', value_hidden: true }]);
    w.set(card);
    w.setStates({ 4: { checked: false, filled: false } });
    w.sessions.control('t-a', { holder: 'human', reason: 'Enter your card', waitFor: { element: 4, state: 'filled' } });
    await w.sessions.tickWatches();
    w.advance(500);
    w.input();
    w.setStates({ 4: { checked: false, filled: true } });
    w.advance(WATCH_IDLE_MS);
    await w.sessions.tickWatches();
    w.advance(WATCH_TICK_MS);
    await w.sessions.tickWatches();
    expect(w.sessions.info('t-a').control).toMatchObject({ holder: 'agent', by: 'person', seq: 2 });
  });

  it("reads the page with its frames listed unread and none looked at, and starts no read while the last one hasn't answered", async () => {
    const w = watched();
    const release = w.holdReads();
    // The hand-over reads the page at once, and that read hasn't answered when the clock ticks twice.
    w.sessions.control('t-a', { holder: 'human', reason: 'Tick the policy box', waitFor: { element: 12, state: 'checked' } });
    const ticks = [w.sessions.tickWatches(), w.sessions.tickWatches()];
    expect(w.reads).toEqual([{ frames: false }]);
    release();
    await Promise.all(ticks);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await w.sessions.tickWatches();
    expect(w.reads).toEqual([{ frames: false }, { frames: false }]);
  });

  it('waits for the person: a box already checked with no input since never hands back', async () => {
    const w = watched();
    w.set(page([box(true)]));
    w.sessions.control('t-a', { holder: 'human', reason: 'r', waitFor: { element: 12, state: 'checked' } });
    for (let i = 0; i < 6; i += 1) {
      w.advance(WATCH_TICK_MS);
      await w.sessions.tickWatches();
    }
    expect(w.sessions.info('t-a').control.holder).toBe('human');
  });

  it('a page change hands back once the new page settles', async () => {
    const w = watched();
    w.sessions.control('t-a', { holder: 'human', reason: 'Solve the check', waitFor: { page: 'changes' } });
    await w.sessions.tickWatches();
    w.advance(500);
    w.input();
    w.set(page([{ id: 1, role: 'button', name: 'Continue' }], 'https://united.test/seats'));
    w.advance(WATCH_IDLE_MS);
    await w.sessions.tickWatches();
    expect(w.sessions.info('t-a').control.holder).toBe('human');
    w.advance(WATCH_TICK_MS);
    await w.sessions.tickWatches();
    expect(w.sessions.info('t-a').control.holder).toBe('agent');
  });

  it("Done first ends the watch, and a hand-over with nothing to wait for isn't watched", async () => {
    const w = watched();
    w.sessions.control('t-a', { holder: 'human', reason: 'r', waitFor: { page: 'changes' } });
    w.sessions.handBack('t-a');
    expect(w.stopped()).toBe(1);
    expect(w.sessions.info('t-a').control).toMatchObject({ holder: 'agent', seq: 2 });
    w.sessions.control('t-a', { holder: 'human', reason: 'Sign in' });
    expect(w.ticks).toHaveLength(1);
    expect(w.sessions.stateOf('t-a')?.watching).toBe(false);
  });
});
