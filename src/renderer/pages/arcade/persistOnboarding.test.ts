import { describe, it, expect, vi } from 'vitest';
import { persistOnboarding, resolveFinalizeOutcome, type PersistDeps } from './OnboardingScreen';

function makeDeps(over: Partial<PersistDeps> = {}): PersistDeps {
  return {
    saveSettings: vi.fn(async () => true),
    syncToDb: vi.fn(async () => true),
    syncModels: vi.fn(async () => {}),
    syncHarness: vi.fn(async () => {}),
    ...over,
  };
}

describe('persistOnboarding', () => {
  it('returns ok when every step succeeds', async () => {
    await expect(persistOnboarding(makeDeps(), ['ANTON_X=1'])).resolves.toEqual({ ok: true });
  });

  // ENG-817 review (pnewsam): a failed AUTHORITATIVE DB write must NOT let
  // onboarding advance to success — the config didn't actually persist.
  it('fails when the DB sync returns false, and skips the best-effort follow-ups', async () => {
    const d = makeDeps({ syncToDb: vi.fn(async () => false) });
    const res = await persistOnboarding(d, ['ANTON_X=1']);
    expect(res.ok).toBe(false);
    // dbSyncFailed distinguishes "the write was rejected/unreachable" from a
    // thrown error, so finalizeSettings can defer to the install check
    // instead of erroring when the server just isn't up yet.
    if (!res.ok) expect(res.dbSyncFailed).toBe(true);
    expect(d.syncModels).not.toHaveBeenCalled();
    expect(d.syncHarness).not.toHaveBeenCalled();
  });

  // A real .env write error (non-403, which host.saveSettings now propagates)
  // surfaces to the user rather than being swallowed.
  it('fails and surfaces the message when the .env write throws', async () => {
    const d = makeDeps({ saveSettings: vi.fn(async () => { throw new Error('HTTP 500'); }) });
    const res = await persistOnboarding(d, ['ANTON_X=1']);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('500');
      // Not a DB-sync rejection — a thrown .env error must always be a real,
      // user-facing failure, never deferred.
      expect(res.dbSyncFailed).toBeUndefined();
    }
  });

  // The expected web loopback 403 makes host.saveSettings return false (best-
  // effort .env), which must NOT block success as long as the DB write lands.
  it('still succeeds when the best-effort .env write returns false but the DB write succeeds', async () => {
    const d = makeDeps({ saveSettings: vi.fn(async () => false) });
    await expect(persistOnboarding(d, ['ANTON_X=1'])).resolves.toEqual({ ok: true });
  });
});

describe('resolveFinalizeOutcome', () => {
  const OK = { ok: true as const };
  const DB_FAIL = { ok: false as const, error: 'Could not save your settings to the server. Please try again.', dbSyncFailed: true as const };
  const THROWN = { ok: false as const, error: 'HTTP 500' };
  const NOT_READY = { antonInstalled: false, serverDepsReady: false };
  const READY = { antonInstalled: true, serverDepsReady: true };

  it('succeeds when persistOnboarding succeeded', () => {
    expect(resolveFinalizeOutcome(OK, null)).toEqual({ action: 'success' });
  });

  // The onboarding/install race: the DB write was rejected because the local
  // server hasn't finished installing/starting yet — this must defer to the
  // setup screen, not block the user with a "could not save" error.
  it('defers when the DB sync failed and the server is not installed/ready', () => {
    expect(resolveFinalizeOutcome(DB_FAIL, NOT_READY)).toEqual({ action: 'defer' });
  });

  // A DB sync failure against an ALREADY-ready server is a genuine failure.
  it('errors when the DB sync failed but the server is installed and ready', () => {
    expect(resolveFinalizeOutcome(DB_FAIL, READY)).toEqual({ action: 'error', error: DB_FAIL.error });
  });

  // checkInstall itself failed (finalizeSettings passes null) — can't confirm
  // a not-ready race, so fail safe with the existing error instead of
  // silently deferring.
  it('errors when install status could not be determined', () => {
    expect(resolveFinalizeOutcome(DB_FAIL, null)).toEqual({ action: 'error', error: DB_FAIL.error });
  });

  // A thrown .env/IPC error is never deferred, even if the server happens to
  // be not-ready — it's a different failure than a DB-sync rejection.
  it('errors on a thrown failure regardless of install status', () => {
    expect(resolveFinalizeOutcome(THROWN, NOT_READY)).toEqual({ action: 'error', error: THROWN.error });
  });
});
