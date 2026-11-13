import { describe, expect, it } from 'vitest';
import type { PageElement, PageSnapshot } from '../shared/browser-contract';
import { parseControlRequest } from '../shared/browser-contract';
import { BrowserSessions, type TabHooks, type TabView } from './browser-sessions';
import { pageChanged, pageKey, WATCH_IDLE_MS, WATCH_TICK_MS, waitForMet } from './browser-handover-watch';

const page = (elements: PageElement[], url = 'https://united.test/minor'): PageSnapshot => ({
  url, title: 'T', scroll: { y: 0, height: 100, viewport: 100 }, elements, text: '', truncated: false, challenges: [],
});
const box = (checked: boolean): PageElement => ({ id: 12, role: 'checkbox', name: "I've read and understood", checked });

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
  it('reads a box as checked, a field as filled without its value, and a page as changed', () => {
    expect(waitForMet({ element: 12, state: 'checked' }, page([box(false)]), page([box(true)]))).toBe(true);
    expect(waitForMet({ element: 12, state: 'checked' }, page([box(false)]), page([box(false)]))).toBe(false);
    const field = (value?: string): PageElement => ({ id: 4, role: 'textbox', name: 'Name', ...(value === undefined ? {} : { value }) });
    expect(waitForMet({ element: 4, state: 'filled' }, null, page([field('Ana')]))).toBe(true);
    expect(waitForMet({ element: 4, state: 'filled' }, null, page([field('  ')]))).toBe(false);
    expect(waitForMet({ element: 4, state: 'filled' }, null, page([{ id: 4, role: 'textbox', name: 'Code', value_hidden: true }]))).toBe(false);
    // Gone because the person moved on to another page: done.
    expect(waitForMet({ element: 12, state: 'checked' }, page([box(false)]), page([], 'https://united.test/next'))).toBe(true);
    expect(waitForMet({ page: 'changes' }, page([box(false)]), page([box(false)], 'https://united.test/next'))).toBe(true);
  });

  it('counts a page as changed only when its element list differs materially', () => {
    const els = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: i, role: 'link', name: `L${i + from}` }));
    expect(pageChanged(page(els(20)), page(els(20)))).toBe(false);
    expect(pageChanged(page(els(20)), page([...els(19), { id: 99, role: 'link', name: 'new' }]))).toBe(false);
    expect(pageChanged(page(els(20)), page(els(20, 5)))).toBe(true);
    expect(pageChanged(page(els(3)), page(els(3, 3)))).toBe(true);
  });

  it('never puts a value in what it compares', () => {
    expect(pageKey(page([{ id: 4, role: 'textbox', name: 'Name', value: 'secret-ish' }]))).not.toContain('secret-ish');
  });
});

function watched() {
  let clock = 1_000_000;
  let current = page([box(false)]);
  const ticks: Array<() => void> = [];
  let stopped = 0;
  let hooks: TabHooks | null = null;
  const view = {
    url: () => current.url, title: () => 'T', loading: () => false, canGoBack: () => false, canGoForward: () => false,
    read: async () => current, act: async () => {}, screenshot: async () => ({ jpeg: Buffer.from(''), width: 1, height: 1 }),
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
    input: () => hooks?.personInput(),
    advance: (ms: number) => { clock += ms; },
    ticks,
    stopped: () => stopped,
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
