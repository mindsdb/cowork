import { describe, it, expect, vi } from 'vitest';
import { persistOnboarding, resolveFinalizeOutcome, type PersistDeps } from './OnboardingScreen';

function makeDeps(over: Partial<PersistDeps> = {}): PersistDeps {
  return {
    pushToServer: vi.fn(async () => true),
    syncHarness: vi.fn(async () => {}),
    ...over,
  };
}

// ENG-1127: persistOnboarding takes a DB-keyed values object (not `.env` lines).
const VALUES = { anthropic_api_key: 'sk-ant', planning_provider: 'anthropic' };

describe('persistOnboarding', () => {
  it('returns ok when every step succeeds', async () => {
    await expect(persistOnboarding(makeDeps(), VALUES)).resolves.toEqual({ ok: true });
  });

  it('hands the DB-keyed values object straight to the bulk push', async () => {
    const pushToServer = vi.fn(async () => true);
    await persistOnboarding(makeDeps({ pushToServer }), VALUES);
    expect(pushToServer).toHaveBeenCalledWith(VALUES);
  });

  // ENG-1127: the single bulk push is the ONLY write and is authoritative — a
  // `false` means settings did NOT persist, so onboarding must not advance to
  // success (ENG-817), and the best-effort harness sync is skipped.
  it('fails when the bulk push returns false, and skips the best-effort harness sync', async () => {
    const syncHarness = vi.fn(async () => {});
    const d = makeDeps({ pushToServer: vi.fn(async () => false), syncHarness });
    const res = await persistOnboarding(d, VALUES);
    expect(res.ok).toBe(false);
    // dbSyncFailed distinguishes "the write was rejected/unreachable" from a
    // thrown error, so finalizeSettings can defer to the install check
    // instead of erroring when the server just isn't up yet.
    if (!res.ok) expect(res.dbSyncFailed).toBe(true);
    expect(syncHarness).not.toHaveBeenCalled();
  });

  // ENG-848: syncHarness runs AFTER the authoritative bulk push and is
  // best-effort — a throw must not bounce a user whose config already persisted.
  it('still succeeds when syncHarness throws after the push lands', async () => {
    const d = makeDeps({ syncHarness: vi.fn(async () => { throw new Error('harness sync flaked'); }) });
    await expect(persistOnboarding(d, VALUES)).resolves.toEqual({ ok: true });
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
