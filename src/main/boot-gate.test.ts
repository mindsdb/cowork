import { describe, it, expect, vi, afterEach } from 'vitest';
import { awaitBootGate, BOOT_UPDATE_BUDGET_MS, SERVER_REINSTALL_CAP_MS } from './boot-gate';
import { SERVER_START_CAP_MS } from '../shared/server-status';

afterEach(() => {
  vi.useRealTimers();
});

describe('awaitBootGate', () => {
  it('resolves as soon as the boot poll settles, well before the budget', async () => {
    vi.useFakeTimers();
    let done = false;
    awaitBootGate(Promise.resolve(), 1_000).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('still resolves when the boot poll rejects (never traps the loading screen)', async () => {
    vi.useFakeTimers();
    let done = false;
    awaitBootGate(Promise.reject(new Error('boot failed')), 1_000).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  // ENG-749 regression: the gate must NOT release at 45s (the old renderer-side
  // fail-open) while a legitimately slow update is still running — it holds until
  // the barrier settles, or the last-resort budget as a genuine-hang escape.
  it('leaves the gate pending far past 45s when the barrier hangs, releasing only at the budget', async () => {
    vi.useFakeTimers();
    let done = false;
    awaitBootGate(new Promise<void>(() => {}), BOOT_UPDATE_BUDGET_MS).then(() => { done = true; });

    await vi.advanceTimersByTimeAsync(45_000);
    expect(done).toBe(false); // the removed 45s cap would have fired here

    await vi.advanceTimersByTimeAsync(SERVER_REINSTALL_CAP_MS + SERVER_START_CAP_MS);
    expect(done).toBe(false); // still within the legitimate reinstall+restart envelope

    await vi.advanceTimersByTimeAsync(BOOT_UPDATE_BUDGET_MS);
    expect(done).toBe(true); // backstop finally releases
  });

  it('budget covers the worst-case update path (reinstall + restart, twice) so it never fires mid-update', () => {
    expect(BOOT_UPDATE_BUDGET_MS).toBeGreaterThanOrEqual(
      2 * (SERVER_REINSTALL_CAP_MS + SERVER_START_CAP_MS),
    );
  });
});
