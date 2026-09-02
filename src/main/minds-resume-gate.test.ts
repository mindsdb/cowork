import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginMindsResumeCredentialGate,
  isMindsResumeCredentialGateActive,
  MINDS_RESUME_READY_TIMEOUT_MS,
  resetMindsResumeCredentialGate,
  settleMindsResumeCredentialGate,
  waitForMindsResumeCredential,
} from './minds-resume-gate';

afterEach(() => {
  settleMindsResumeCredentialGate(true);
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('Minds resume credential gate', () => {
  it('keeps its timeout below the renderer reservation reap floor', () => {
    expect(MINDS_RESUME_READY_TIMEOUT_MS).toBeLessThan(13_000);
  });

  it('keeps the first barrier when a second resume arms one', async () => {
    beginMindsResumeCredentialGate();
    const firstWaiter = waitForMindsResumeCredential();

    // A second wake must not replace the gate object. If it does, waiters
    // parked on the first promise never observe the settle and burn the full
    // bound before being cancelled, even though the refresh succeeded.
    beginMindsResumeCredentialGate();
    settleMindsResumeCredentialGate(true);

    await expect(firstWaiter).resolves.toBe(true);
  });

  it('leaves an unarmed gate open when settle reports failure', async () => {
    // `doRefreshTokens`'s no_refresh_token path and `beginMindsCredentialSignOut`
    // both settle unconditionally. On an install that never armed a barrier that
    // must be a no-op: latching blocked with no gate promise cancels every later
    // MindsHub response immediately, until sign-in or a pasted key.
    expect(isMindsResumeCredentialGateActive()).toBe(false);

    settleMindsResumeCredentialGate(false);

    expect(isMindsResumeCredentialGateActive()).toBe(false);
    await expect(waitForMindsResumeCredential()).resolves.toBe(true);
  });

  it('releases waiters only after readiness is observed', async () => {
    beginMindsResumeCredentialGate();
    let settled = false;
    const waiting = waitForMindsResumeCredential().then((ready) => {
      settled = true;
      return ready;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    settleMindsResumeCredentialGate(true);
    await expect(waiting).resolves.toBe(true);
  });

  it('returns false at the bound when refresh and handoff never become ready', async () => {
    vi.useFakeTimers();
    beginMindsResumeCredentialGate();

    const waiting = waitForMindsResumeCredential();
    await vi.advanceTimersByTimeAsync(MINDS_RESUME_READY_TIMEOUT_MS - 1);
    let settled = false;
    void waiting.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(waiting).resolves.toBe(false);
  });

  it('honors a shorter caller-supplied remainder of the request bound', async () => {
    vi.useFakeTimers();
    beginMindsResumeCredentialGate();

    const waiting = waitForMindsResumeCredential(3_000);
    await vi.advanceTimersByTimeAsync(2_999);
    let settled = false;
    void waiting.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(waiting).resolves.toBe(false);
  });

  it('keeps later requests blocked after an unusable handoff', async () => {
    beginMindsResumeCredentialGate();
    settleMindsResumeCredentialGate(false);

    await expect(waitForMindsResumeCredential()).resolves.toBe(false);

    settleMindsResumeCredentialGate(true);
    await expect(waitForMindsResumeCredential()).resolves.toBe(true);
  });

  it('releases waiters and stops blocking when the session goes away', async () => {
    // Sign-out has no resumed credential to wait for, and nothing in the
    // signed-out state can ever settle the gate true. Leaving it blocked would
    // cancel every later turn, including direct-provider turns.
    beginMindsResumeCredentialGate();
    const waiting = waitForMindsResumeCredential();

    resetMindsResumeCredentialGate();

    await expect(waiting).resolves.toBe(false);
    expect(isMindsResumeCredentialGateActive()).toBe(false);
    await expect(waitForMindsResumeCredential()).resolves.toBe(true);
  });

  it('clears a gate that was already latched shut', async () => {
    beginMindsResumeCredentialGate();
    settleMindsResumeCredentialGate(false);
    expect(isMindsResumeCredentialGateActive()).toBe(true);

    resetMindsResumeCredentialGate();

    expect(isMindsResumeCredentialGateActive()).toBe(false);
    await expect(waitForMindsResumeCredential()).resolves.toBe(true);
  });
});
