import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirmRestart,
  guardRestart,
  resetRestartConfirmationForTests,
  subscribeRestartConfirmation,
  type PendingRestartConfirmation,
} from './restart-guard';

afterEach(() => resetRestartConfirmationForTests());

/** Stand in for RestartConfirmHost: answer the next question with `answer`. */
function mountAnswerer(answer: boolean) {
  const seen: PendingRestartConfirmation[] = [];
  subscribeRestartConfirmation((pending) => {
    if (!pending) return;
    seen.push(pending);
    pending.resolve(answer);
  });
  return seen;
}

describe('guardRestart', () => {
  it('passes a boolean answer straight through, as every older shell returns', async () => {
    const invoke = vi.fn(async () => true);
    expect(await guardRestart(invoke)).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith({});
  });

  it('asks, then re-sends with force after a yes', async () => {
    const seen = mountAnswerer(true);
    const invoke = vi.fn(async (options: { force?: boolean }) => (
      options.force ? true : { confirm: true as const, runningTasks: 2 }
    ));
    expect(await guardRestart(invoke)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].runningTasks).toBe(2);
    expect(invoke).toHaveBeenNthCalledWith(2, { force: true });
  });

  it('reports a no as cancelled, not failed, and never forces', async () => {
    mountAnswerer(false);
    const invoke = vi.fn(async () => ({ confirm: true as const, runningTasks: null }));
    expect(await guardRestart(invoke)).toBe('cancelled');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does not restart when nothing is mounted to ask', async () => {
    const invoke = vi.fn(async () => ({ confirm: true as const, runningTasks: 1 }));
    expect(await guardRestart(invoke)).toBe('cancelled');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('treats a report that survives force as not restarted', async () => {
    mountAnswerer(true);
    const invoke = vi.fn(async () => ({ confirm: true as const, runningTasks: 1 }));
    expect(await guardRestart(invoke)).toBe(false);
  });
});

describe('confirmRestart', () => {
  it('answers a second question no while one is already open', async () => {
    let first: PendingRestartConfirmation | null = null;
    subscribeRestartConfirmation((pending) => { if (pending && !first) first = pending; });
    const a = confirmRestart({ confirm: true, runningTasks: 1 });
    const b = confirmRestart({ confirm: true, runningTasks: 1 });
    expect(await b).toBe(false);
    first!.resolve(true);
    expect(await a).toBe(true);
  });

  it('publishes null once answered so the dialog closes', async () => {
    const states: Array<PendingRestartConfirmation | null> = [];
    subscribeRestartConfirmation((pending) => { states.push(pending); });
    const p = confirmRestart({ confirm: true, runningTasks: 3 });
    states[1]!.resolve(false);
    await p;
    expect(states.map((s) => (s ? 'open' : 'closed'))).toEqual(['closed', 'open', 'closed']);
  });
});
