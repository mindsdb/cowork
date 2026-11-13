import { describe, expect, it, vi } from 'vitest';
import { WARM_UP_INTERVAL_MS, createBrowserWarmUp } from './browserWarmUp';

function setup() {
  let clock = 1_000_000;
  const provision = vi.fn(async () => ({ status: 'starting' }));
  const warm = createBrowserWarmUp(provision, { now: () => clock });
  return { provision, warm, advance: (ms) => { clock += ms; } };
}

describe('createBrowserWarmUp', () => {
  it('fires once per task until two minutes have passed', () => {
    const { provision, warm, advance } = setup();
    expect(warm('t1')).toBe(true);
    expect(warm('t1')).toBe(false);
    advance(WARM_UP_INTERVAL_MS - 1);
    expect(warm('t1')).toBe(false);
    advance(1);
    expect(warm('t1')).toBe(true);
    expect(provision).toHaveBeenCalledTimes(2);
  });

  it('debounces each task on its own', () => {
    const { provision, warm } = setup();
    expect(warm('t1')).toBe(true);
    expect(warm('t2')).toBe(true);
    expect(warm('t1')).toBe(false);
    expect(provision).toHaveBeenCalledTimes(2);
  });

  it('ignores a missing task id', () => {
    const { provision, warm } = setup();
    expect(warm('')).toBe(false);
    expect(warm(undefined)).toBe(false);
    expect(provision).not.toHaveBeenCalled();
  });

  it('swallows failures, rejected or thrown', async () => {
    const rejecting = createBrowserWarmUp(() => Promise.reject(new Error('503')));
    expect(rejecting('t1')).toBe(true);
    const throwing = createBrowserWarmUp(() => { throw new Error('offline'); });
    expect(throwing('t1')).toBe(true);
    await Promise.resolve();
  });
});
