/*
 * A hand-over that comes back by itself (POST /sessions/{id}/control with
 * wait_for). While the person holds the browser, the host reads the page
 * every WATCH_TICK_MS in its isolated world (no debugger) and hands it back
 * exactly as Done does once three things hold:
 *
 *   - what the hand-over waits for happened: the element is checked, the
 *     field has a value (only whether it has one; the value is never read
 *     out), or the page changed (another address, or its element list
 *     differs by at least max(3, 20%) of its role and name pairs), and
 *   - the person used the browser since the hand-over, and has not for
 *     WATCH_IDLE_MS, so a box they are about to untick or a form they are
 *     still filling isn't taken from under them, and
 *   - the page read the same on two reads in a row: it settled.
 *
 * An element that is gone because the page moved on counts as done: the
 * person ticked the box and went on themselves.
 */

import type { PageSnapshot, WaitFor } from '../shared/browser-contract';

export const WATCH_TICK_MS = 1_000;
export const WATCH_IDLE_MS = 3_000;

/* The pairs a page's elements are named by, as a multiset. */
function namesOf(page: PageSnapshot): Map<string, number> {
  const names = new Map<string, number>();
  for (const el of page.elements) {
    const key = `${el.role}\u0000${el.name}`;
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  return names;
}

/** Whether the page moved on from `before`: another address, or an element list that differs materially. */
export function pageChanged(before: PageSnapshot, now: PageSnapshot): boolean {
  if (before.url !== now.url) return true;
  const a = namesOf(before);
  const b = namesOf(now);
  let differ = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) differ += Math.abs((a.get(key) ?? 0) - (b.get(key) ?? 0));
  const size = Math.max(before.elements.length, now.elements.length);
  return differ >= Math.max(3, Math.ceil(size * 0.2));
}

/** Whether what the hand-over waits for happened on `now`, against the page it was handed over on. */
export function waitForMet(waitFor: WaitFor, before: PageSnapshot | null, now: PageSnapshot): boolean {
  if ('page' in waitFor) return before !== null && pageChanged(before, now);
  const el = now.elements.find((e) => e.id === waitFor.element);
  if (!el) return before !== null && before.url !== now.url;
  if (waitFor.state === 'checked') return el.checked === true;
  // Filled: a value the page shows. A secret field's is never sent, so it can't say.
  return typeof el.value === 'string' && el.value.trim().length > 0;
}

/** What a read of the page is compared by for settling: never a field's value, only whether it has one. */
export function pageKey(page: PageSnapshot): string {
  return JSON.stringify([
    page.url,
    page.elements.map((e) => [e.id, e.role, e.name, e.checked ?? null, Boolean(e.value)]),
  ]);
}

export interface HandOverWatch {
  waitFor: WaitFor;
  /** The control record's seq the watch belongs to. */
  seq: number;
  handedAt: number;
  /** The page as it was handed over; null until the first read lands. */
  before: PageSnapshot | null;
  /** The last read's key, to tell a settled page. */
  lastKey: string | null;
}

/**
 * One tick's verdict: whether to hand back now. Updates the watch's
 * baseline and last key.
 */
export function watchTick(watch: HandOverWatch, page: PageSnapshot, { now, lastPersonInputAt }: { now: number; lastPersonInputAt: number }): boolean {
  const key = pageKey(page);
  const settled = watch.lastKey === key;
  watch.lastKey = key;
  if (watch.before === null) {
    watch.before = page;
    return false;
  }
  if (!settled) return false;
  if (lastPersonInputAt <= watch.handedAt || now - lastPersonInputAt < WATCH_IDLE_MS) return false;
  return waitForMet(watch.waitFor, watch.before, page);
}
