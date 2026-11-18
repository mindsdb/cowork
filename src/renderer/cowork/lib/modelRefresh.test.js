import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAvailabilityRefresher, createTrailingThrottle, mergeChangesNothing } from './modelRefresh';
import { mergeRecommendedModels } from './settingsTransform';

const clock = () => Date.now();

describe('createTrailingThrottle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs the first call at once', async () => {
    const fn = vi.fn();
    await createTrailingThrottle(fn, 5000, clock).call('x');
    expect(fn).toHaveBeenCalledWith('x');
  });

  it('defers a call inside the window to its end instead of dropping it', async () => {
    const fn = vi.fn();
    const throttle = createTrailingThrottle(fn, 5000, clock);
    await throttle.call();
    vi.advanceTimersByTime(1000);
    throttle.call();
    throttle.call();
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('merges the args of calls queued in one window', async () => {
    const fn = vi.fn();
    const throttle = createTrailingThrottle(fn, 5000, clock, (a, b) => `${a}+${b}`);
    await throttle.call('first');
    throttle.call('a');
    throttle.call('b');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenLastCalledWith('a+b');
  });

  it('cancels a queued run', async () => {
    const fn = vi.fn();
    const throttle = createTrailingThrottle(fn, 5000, clock);
    await throttle.call();
    throttle.call();
    throttle.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('swallows a failing run', async () => {
    const throttle = createTrailingThrottle(() => { throw new Error('down'); }, 5000, clock);
    await expect(throttle.call()).resolves.toBeUndefined();
  });
});

describe('createAvailabilityRefresher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses the broader scope when a picker open and a trigger share a deferred run', async () => {
    const fetch = vi.fn().mockResolvedValue({});
    const r = createAvailabilityRefresher({ fetch, apply: vi.fn(), now: clock });
    await r.refresh('minds');
    r.refresh('minds');
    r.refresh('all');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch.mock.calls.map(([scope]) => scope)).toEqual(['minds', 'all']);
  });

  it('keeps a queued trigger narrow when nothing broader joins it', async () => {
    const fetch = vi.fn().mockResolvedValue({});
    const r = createAvailabilityRefresher({ fetch, apply: vi.fn(), now: clock });
    await r.refresh('all');
    r.refresh('minds');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch.mock.calls.map(([scope]) => scope)).toEqual(['all', 'minds']);
  });

  it('drops a response that started before the last applied one', async () => {
    let resolveOld;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise((res) => { resolveOld = res; }))
      .mockResolvedValueOnce({ v: 'new' });
    const apply = vi.fn();
    const r = createAvailabilityRefresher({ fetch, apply, now: clock });
    r.refresh();
    await vi.advanceTimersByTimeAsync(0);
    r.refresh();
    await vi.advanceTimersByTimeAsync(5000);
    expect(apply).toHaveBeenCalledWith({ v: 'new' });
    resolveOld({ v: 'old' });
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('never applies a failed response, so it cannot shadow an older good one', async () => {
    let resolveOld;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise((res) => { resolveOld = res; }))
      .mockResolvedValueOnce(null);
    const apply = vi.fn();
    const r = createAvailabilityRefresher({ fetch, apply, now: clock });
    r.refresh();
    await vi.advanceTimersByTimeAsync(0);
    r.refresh();
    await vi.advanceTimersByTimeAsync(5000);
    resolveOld({ v: 'old' });
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledWith({ v: 'old' });
  });
});

describe('mergeChangesNothing', () => {
  const prev = { modelEnabled: { a: true }, modelDisabledReasons: {}, recommendedModels: { m: ['a'] } };

  it('is true when every merged key equals the current value one level deep', () => {
    expect(mergeChangesNothing(prev, { modelEnabled: { a: true }, modelDisabledReasons: {} })).toBe(true);
  });

  it('is false when a model unlocks', () => {
    expect(mergeChangesNothing(prev, { modelEnabled: { a: false } })).toBe(false);
  });

  it('skips the same real response merged twice, though the merge builds fresh objects', () => {
    const response = {
      recommendedModels: { 'minds-cloud': ['sonnet', 'gpt'] },
      recommendedPair: { 'minds-cloud': ['sonnet', 'gpt'] },
      modelEfforts: { sonnet: { levels: ['low', 'high'], default: 'low' } },
      modelEnabled: { sonnet: true, gpt: false },
      modelDisabledReasons: { gpt: 'wallet_empty' },
      modelLabels: { sonnet: 'Sonnet', gpt: 'GPT' },
      modelProviders: { sonnet: 'anthropic', gpt: 'openai' },
      modelFamilies: { sonnet: 'sonnet', gpt: 'gpt' },
    };
    const first = mergeRecommendedModels({}, response, { keepOrder: true });
    const held = { ...first };
    const again = mergeRecommendedModels(held, structuredClone(response), { keepOrder: true });
    expect(again.recommendedModels).not.toBe(held.recommendedModels);
    expect(mergeChangesNothing(held, again)).toBe(true);
    const unlocked = mergeRecommendedModels(held, { ...response, modelEnabled: { sonnet: true, gpt: true }, modelDisabledReasons: {} }, { keepOrder: true });
    expect(mergeChangesNothing(held, unlocked)).toBe(false);
  });

  it('is false when a nested list is a new array, so new models still land', () => {
    expect(mergeChangesNothing(prev, { recommendedModels: { m: ['a', 'b'] } })).toBe(false);
  });
});
