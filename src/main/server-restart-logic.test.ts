import { describe, it, expect } from 'vitest';
import {
  AUTO_RESTART_DELAYS_MS,
  AUTO_RESTART_WINDOW_MS,
  decideAutoRestart,
  recentRestartsAfter,
} from './server-restart-logic';

const NOW = 10_000_000;

describe('decideAutoRestart', () => {
  it('brings back a backend that was serving and died on its own', () => {
    expect(decideAutoRestart({ intentional: false, wasRunning: true, recentRestarts: [], now: NOW }))
      .toEqual({ action: 'restart', delayMs: AUTO_RESTART_DELAYS_MS[0] });
  });

  it('leaves a stop the app asked for alone', () => {
    expect(decideAutoRestart({ intentional: true, wasRunning: true, recentRestarts: [], now: NOW }))
      .toEqual({ action: 'none', reason: 'intentional' });
  });

  it('leaves a start that never answered to its own failure report', () => {
    expect(decideAutoRestart({ intentional: false, wasRunning: false, recentRestarts: [], now: NOW }))
      .toEqual({ action: 'none', reason: 'not-up' });
  });

  it('waits longer each time it has to restart again soon', () => {
    const after = (n: number) => decideAutoRestart({
      intentional: false, wasRunning: true, recentRestarts: Array.from({ length: n }, (_, i) => NOW - 1000 * (n - i)), now: NOW,
    });
    expect(after(1)).toEqual({ action: 'restart', delayMs: AUTO_RESTART_DELAYS_MS[1] });
    expect(after(2)).toEqual({ action: 'restart', delayMs: AUTO_RESTART_DELAYS_MS[2] });
  });

  it('stops retrying a backend that keeps dying', () => {
    const recentRestarts = AUTO_RESTART_DELAYS_MS.map((_, i) => NOW - 60_000 * (i + 1));
    expect(decideAutoRestart({ intentional: false, wasRunning: true, recentRestarts, now: NOW }))
      .toEqual({ action: 'none', reason: 'crash-loop' });
  });

  it('forgets restarts older than the window', () => {
    const recentRestarts = AUTO_RESTART_DELAYS_MS.map(() => NOW - AUTO_RESTART_WINDOW_MS - 1);
    expect(decideAutoRestart({ intentional: false, wasRunning: true, recentRestarts, now: NOW }))
      .toEqual({ action: 'restart', delayMs: AUTO_RESTART_DELAYS_MS[0] });
  });
});

describe('recentRestartsAfter', () => {
  it('adds the new restart and drops the expired ones', () => {
    expect(recentRestartsAfter([NOW - AUTO_RESTART_WINDOW_MS - 5, NOW - 10], NOW)).toEqual([NOW - 10, NOW]);
  });
});
