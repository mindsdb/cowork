import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginMindsResumeCredentialGate,
  MINDS_RESUME_READY_TIMEOUT_MS,
  settleMindsResumeCredentialGate,
  waitForMindsResumeCredential,
} from './minds-resume-gate';

afterEach(() => {
  settleMindsResumeCredentialGate(true);
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('Minds resume credential gate', () => {
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
});
