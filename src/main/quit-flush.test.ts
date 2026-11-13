import { afterEach, describe, expect, it, vi } from 'vitest';

// The registry is module state, so every test starts from a fresh module.
async function load() {
  vi.resetModules();
  return import('./quit-flush');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('quit flushes', () => {
  it('resolves true when nothing is registered', async () => {
    const q = await load();
    await expect(q.runQuitFlushes(10)).resolves.toBe(true);
  });

  it('waits for every registered flush', async () => {
    const q = await load();
    const done: string[] = [];
    q.registerQuitFlush(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      done.push('slow');
    });
    q.registerQuitFlush(async () => { done.push('fast'); });
    await expect(q.runQuitFlushes(1_000)).resolves.toBe(true);
    expect(done.sort()).toEqual(['fast', 'slow']);
  });

  it('gives up at the ceiling', async () => {
    vi.useFakeTimers();
    const q = await load();
    q.registerQuitFlush(() => new Promise<void>(() => undefined));
    const result = q.runQuitFlushes(q.QUIT_FLUSH_CEILING_MS);
    await vi.advanceTimersByTimeAsync(q.QUIT_FLUSH_CEILING_MS);
    await expect(result).resolves.toBe(false);
  });

  it('counts a failing flush as finished, whether it rejects or throws', async () => {
    const q = await load();
    q.registerQuitFlush(async () => { throw new Error('disk full'); });
    q.registerQuitFlush(() => { throw new Error('thrown before any promise'); });
    await expect(q.runQuitFlushes(1_000)).resolves.toBe(true);
  });
});

describe('quit holds', () => {
  it('holds every registered writer and resumes each one', async () => {
    const q = await load();
    const events: string[] = [];
    q.registerQuitHold(() => { events.push('hold:a'); return () => events.push('resume:a'); });
    q.registerQuitHold(() => { events.push('hold:b'); return () => events.push('resume:b'); });
    const resume = q.holdQuitWriters();
    expect(events).toEqual(['hold:a', 'hold:b']);
    resume();
    expect(events).toEqual(['hold:a', 'hold:b', 'resume:a', 'resume:b']);
  });
});
