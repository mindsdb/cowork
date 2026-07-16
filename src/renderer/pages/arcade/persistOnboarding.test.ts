import { describe, it, expect, vi } from 'vitest';
import { persistOnboarding, type PersistDeps } from './OnboardingScreen';

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
    expect(d.syncModels).not.toHaveBeenCalled();
    expect(d.syncHarness).not.toHaveBeenCalled();
  });

  // A real .env write error (non-403, which host.saveSettings now propagates)
  // surfaces to the user rather than being swallowed.
  it('fails and surfaces the message when the .env write throws', async () => {
    const d = makeDeps({ saveSettings: vi.fn(async () => { throw new Error('HTTP 500'); }) });
    const res = await persistOnboarding(d, ['ANTON_X=1']);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('500');
  });

  // The expected web loopback 403 makes host.saveSettings return false (best-
  // effort .env), which must NOT block success as long as the DB write lands.
  it('still succeeds when the best-effort .env write returns false but the DB write succeeds', async () => {
    const d = makeDeps({ saveSettings: vi.fn(async () => false) });
    await expect(persistOnboarding(d, ['ANTON_X=1'])).resolves.toEqual({ ok: true });
  });
});
