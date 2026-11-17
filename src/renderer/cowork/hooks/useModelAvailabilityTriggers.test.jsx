/* ENG-4147: a top-up made in the browser must unlock the picker without reopening a menu,
   without polling for users who are locked by an admin rule or never pay. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { hasCreditLock, useModelAvailabilityTriggers, UNARMED_FOCUS_EVERY_MS } from './useModelAvailabilityTriggers';
import { createTrailingThrottle } from '../lib/modelRefresh';
import { ARM_EXPIRES_MS, creditsFlowState, endCreditsFlow, startCreditsFlow } from '../lib/creditsFlow';

const FUNDED = { reachable: true, freeTokens: { limit: 100, used: 10, remaining: 90 }, balance: { usd: 20, canConsume: true, alert: null } };
const EMPTY = { ...FUNDED, balance: { usd: 0, canConsume: false, alert: 'depleted' } };
const LOCKED = { modelEnabled: { sonnet: false }, modelDisabledReasons: { sonnet: 'wallet_empty' }, usage: null };
const OPEN = { modelEnabled: { sonnet: true }, modelDisabledReasons: {}, usage: null };

const setup = (props) => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook((p) => useModelAvailabilityTriggers({ refresh, ...p }), { initialProps: props });
  return { refresh, ...hook };
};
const focus = () => window.dispatchEvent(new Event('focus'));
const blur = () => window.dispatchEvent(new Event('blur'));

beforeEach(() => endCreditsFlow());
afterEach(() => {
  blur();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('hasCreditLock', () => {
  it.each([
    ['wallet_empty', { a: 'wallet_empty' }, true],
    ['an exhausted free allowance', { a: 'included_allowance_exhausted' }, true],
    ['no reason (older sidecar)', {}, true],
    ['an admin restriction', { a: 'model_restricted' }, false],
    ['a spent org budget', { a: 'budget_exceeded' }, false],
  ])('counts a model locked by %s as %s', (_label, reasons, expected) => {
    expect(hasCreditLock({ a: false }, reasons)).toBe(expected);
  });

  it('counts only MindsHub ids when the MindsHub list is known, not custom-endpoint rows', () => {
    expect(hasCreditLock({ custom: false }, {}, ['sonnet'])).toBe(false);
    expect(hasCreditLock({ custom: false, sonnet: false }, {}, ['sonnet'])).toBe(true);
  });

  it('ignores enabled models', () => {
    expect(hasCreditLock({ a: true }, { a: 'wallet_empty' })).toBe(false);
  });
});

describe('useModelAvailabilityTriggers', () => {
  it('re-checks once on focus while a model is credit-locked, with no follow-up', () => {
    vi.useFakeTimers();
    const { refresh } = setup(LOCKED);
    focus();
    vi.advanceTimersByTime(5 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('unarmed, re-checks on focus at most once per UNARMED_FOCUS_EVERY_MS (5 min)', () => {
    vi.useFakeTimers();
    const { refresh } = setup(LOCKED);
    focus();
    vi.advanceTimersByTime(4 * 60_000);
    focus();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(UNARMED_FOCUS_EVERY_MS).toBe(5 * 60_000);
    vi.advanceTimersByTime(60_000);
    focus();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not re-check on focus for admin-restricted or budget locks', () => {
    const { refresh } = setup({ modelEnabled: { a: false, b: false }, modelDisabledReasons: { a: 'model_restricted', b: 'budget_exceeded' }, usage: null });
    focus();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not re-check on focus when nothing is locked', () => {
    const { refresh } = setup(OPEN);
    focus();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('re-checks when the wallet goes from empty to funded, and back', () => {
    const { refresh, rerender } = setup({ ...OPEN, usage: EMPTY });
    expect(refresh).not.toHaveBeenCalled();
    rerender({ ...OPEN, usage: FUNDED });
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ ...OPEN, usage: EMPTY });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('ignores polls that do not change the state, and an unreachable read in between', () => {
    const { refresh, rerender } = setup({ ...OPEN, usage: FUNDED });
    rerender({ ...OPEN, usage: { ...FUNDED, balance: { usd: 19, canConsume: true, alert: null } } });
    rerender({ ...OPEN, usage: { reachable: false } });
    rerender({ ...OPEN, usage: FUNDED });
    expect(refresh).not.toHaveBeenCalled();
  });

  describe('after a billing link', () => {
    it('polls 15s for 2 min, then 30s to 5 min, then 60s to 10 min, then stops and disarms', () => {
      vi.useFakeTimers();
      const { refresh } = setup(LOCKED);
      startCreditsFlow();
      focus();
      expect(refresh).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2 * 60_000);
      expect(refresh).toHaveBeenCalledTimes(1 + 8);
      vi.advanceTimersByTime(3 * 60_000);
      expect(refresh).toHaveBeenCalledTimes(1 + 8 + 6);
      vi.advanceTimersByTime(5 * 60_000);
      expect(refresh).toHaveBeenCalledTimes(1 + 8 + 6 + 5);
      vi.advanceTimersByTime(10 * 60_000);
      expect(refresh).toHaveBeenCalledTimes(1 + 8 + 6 + 5);
      expect(creditsFlowState().armedAt).toBeNull();
    });

    it('pauses on blur and resumes on the next focus while still armed', () => {
      vi.useFakeTimers();
      const { refresh } = setup(LOCKED);
      startCreditsFlow();
      focus();
      blur();
      vi.advanceTimersByTime(60_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      focus();
      vi.advanceTimersByTime(15_000);
      expect(refresh).toHaveBeenCalledTimes(3);
    });

    it('restarts the window on the return from paying: 15s cadence and 10 min count from the focus', () => {
      vi.useFakeTimers();
      vi.spyOn(document, 'hasFocus').mockReturnValue(true);
      const { refresh } = setup(LOCKED);
      startCreditsFlow();
      blur();
      vi.advanceTimersByTime(4 * 60_000);
      expect(refresh).not.toHaveBeenCalled();
      focus();
      expect(refresh).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2 * 60_000);
      expect(refresh).toHaveBeenCalledTimes(1 + 8);
      vi.advanceTimersByTime(8 * 60_000);
      expect(refresh).toHaveBeenCalledTimes(1 + 8 + 6 + 5);
      expect(creditsFlowState().armedAt).toBeNull();
    });

    it('starts polling at once when armed while Cowork keeps focus', () => {
      vi.useFakeTimers();
      vi.spyOn(document, 'hasFocus').mockReturnValue(true);
      const { refresh } = setup(LOCKED);
      startCreditsFlow();
      vi.advanceTimersByTime(30_000);
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('waits for focus when armed while Cowork is in the background', () => {
      vi.useFakeTimers();
      vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      const { refresh } = setup(LOCKED);
      startCreditsFlow();
      vi.advanceTimersByTime(30_000);
      expect(refresh).not.toHaveBeenCalled();
    });

    it('ignores and clears an arm older than 30 minutes that never started polling', () => {
      vi.useFakeTimers();
      const { refresh } = setup(LOCKED);
      startCreditsFlow(Date.now() - ARM_EXPIRES_MS - 1);
      focus();
      vi.advanceTimersByTime(60_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(creditsFlowState().armedAt).toBeNull();
    });

    it('stops and disarms as soon as nothing is credit-locked', () => {
      vi.useFakeTimers();
      const { refresh, rerender } = setup(LOCKED);
      startCreditsFlow();
      focus();
      rerender(OPEN);
      vi.advanceTimersByTime(60_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(creditsFlowState().armedAt).toBeNull();
    });
  });

  it('a balance change soon after a focus re-check still fetches, deferred to the window end', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    const throttle = createTrailingThrottle(fetch, 5000, () => Date.now());
    const refresh = () => throttle.call();
    const { rerender } = renderHook((p) => useModelAvailabilityTriggers({ refresh, ...p }), {
      initialProps: { ...LOCKED, usage: EMPTY },
    });
    focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    rerender({ ...LOCKED, usage: FUNDED });
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  describe('with a server that does not honor the narrow refresh scope', () => {
    const narrow = () => false;

    it('skips the unarmed focus re-check and the usage-transition re-check', () => {
      const { refresh, rerender } = setup({ ...LOCKED, usage: EMPTY, canNarrowRefresh: narrow });
      focus();
      rerender({ ...LOCKED, usage: FUNDED, canNarrowRefresh: narrow });
      expect(refresh).not.toHaveBeenCalled();
    });

    it('still runs the bounded post-billing polling', () => {
      vi.useFakeTimers();
      const { refresh } = setup({ ...LOCKED, canNarrowRefresh: narrow });
      startCreditsFlow();
      focus();
      vi.advanceTimersByTime(15_000);
      expect(refresh).toHaveBeenCalledTimes(2);
    });
  });
});
