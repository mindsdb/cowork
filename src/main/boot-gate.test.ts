import { describe, it, expect, vi, afterEach } from 'vitest';
import { awaitBootSettled } from './boot-gate';

afterEach(() => {
  vi.useRealTimers();
});

describe('awaitBootSettled', () => {
  it('resolves only once every barrier has settled', async () => {
    let done = false;
    let releaseServer!: () => void;
    let releaseUpdate!: () => void;
    const server = new Promise<void>((r) => { releaseServer = r; });
    const update = new Promise<void>((r) => { releaseUpdate = r; });

    const gate = awaitBootSettled([server, update]).then(() => { done = true; });

    releaseServer();
    await Promise.resolve();
    expect(done).toBe(false); // one barrier still pending

    releaseUpdate();
    await gate; // deterministic: wait for the gate itself, not a microtask count
    expect(done).toBe(true);
  });

  // ENG-749 regression: the gate tracks the barrier's real completion, not an
  // internal clock — a slow attempt + rollback can run for minutes and it must
  // stay closed the whole time.
  it('never releases on an internal deadline, even past the removed worst-case budget', async () => {
    vi.useFakeTimers();
    let done = false;
    let release!: () => void;
    const barrier = new Promise<void>((r) => { release = r; });

    awaitBootSettled([barrier]).then(() => { done = true; });

    // Simulate the full worst-case sequence elapsing (detection + reinstall +
    // restart + rollback reinstall + restart), far beyond any wall-clock guess.
    await vi.advanceTimersByTimeAsync(900_000);
    expect(done).toBe(false);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('resolves even when a barrier rejects — a failed boot never traps the loading screen', async () => {
    let done = false;
    await awaitBootSettled([
      Promise.reject(new Error('boot start failed')),
      Promise.resolve(),
    ]).then(() => { done = true; });
    expect(done).toBe(true);
  });
});
