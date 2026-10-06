import { describe, it, expect, vi } from 'vitest';
import { runPostAuthHandshake, type PostAuthDeps } from './postAuth';
import { syncSettingsToDb } from './syncSettings';

function makeDeps(over: Partial<PostAuthDeps> = {}): PostAuthDeps {
  return {
    readSettings: vi.fn(async () => ({ ANTON_PLANNING_PROVIDER: 'openai_compatible' })),
    syncSettingsToDb: vi.fn(async () => true),
    replayModels: vi.fn(async () => true),
    deferredModelLines: null,
    ...over,
  };
}

describe('runPostAuthHandshake', () => {
  // Settings saves memory prefs to the DB only, so the .env still holds the
  // first onboarding's defaults. Signing in must not write those back.
  it('a stale .env memory mode does not overwrite the stored one on sign-in', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    try {
      const deps = makeDeps({
        readSettings: vi.fn(async () => ({
          ANTON_PLANNING_PROVIDER: 'minds-cloud',
          ANTON_MEMORY_MODE: 'autopilot',
          ANTON_EPISODIC_MEMORY: 'true',
        })),
        syncSettingsToDb,
      });
      expect(await runPostAuthHandshake(deps)).toEqual({ next: 'terminal', clearDeferred: true });
      const written = fetchMock.mock.calls.map(([url]) => String(url).split('/settings/')[1]);
      expect(written).toContain('planning_provider');
      expect(written).not.toContain('memory_mode');
      expect(written).not.toContain('episodic_memory');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('no deferred model → terminal, payload cleared', async () => {
    const deps = makeDeps({ deferredModelLines: null });
    expect(await runPostAuthHandshake(deps)).toEqual({ next: 'terminal', clearDeferred: true });
    expect(deps.replayModels).not.toHaveBeenCalled();
  });

  it('deferred model replays successfully → terminal, payload cleared', async () => {
    const replayModels = vi.fn(async () => true);
    const deps = makeDeps({ deferredModelLines: ['ANTON_PLANNING_MODEL=gpt-5.5'], replayModels });
    expect(await runPostAuthHandshake(deps)).toEqual({ next: 'terminal', clearDeferred: true });
    expect(replayModels).toHaveBeenCalledWith(['ANTON_PLANNING_MODEL=gpt-5.5']);
  });

  // The #455 review case: retries exhausted → do NOT silently enter the app;
  // route to a retryable error and KEEP the payload.
  it('deferred model fails to replay → setupError, payload retained', async () => {
    const deps = makeDeps({
      deferredModelLines: ['ANTON_PLANNING_MODEL=gpt-5.5'],
      replayModels: vi.fn(async () => false),
    });
    expect(await runPostAuthHandshake(deps)).toEqual({ next: 'setupError', clearDeferred: false });
  });

  // A thrown handshake with a model owed is symmetric with replay-returns-false:
  // surface the retryable error, keep the payload — don't silently lose the model.
  it('thrown handshake WITH a deferred model → setupError, payload retained', async () => {
    const deps = makeDeps({
      deferredModelLines: ['ANTON_PLANNING_MODEL=gpt-5.5'],
      syncSettingsToDb: vi.fn(async () => { throw new Error('offline'); }),
    });
    expect(await runPostAuthHandshake(deps)).toEqual({ next: 'setupError', clearDeferred: false });
  });

  // No model owed: a thrown bulk sync keeps the existing best-effort contract
  // (enter the app; provider/keys reconcile from .env on next restart).
  it('thrown handshake with NO deferred model → terminal (best-effort)', async () => {
    const deps = makeDeps({
      deferredModelLines: null,
      syncSettingsToDb: vi.fn(async () => { throw new Error('offline'); }),
    });
    expect(await runPostAuthHandshake(deps)).toEqual({ next: 'terminal', clearDeferred: false });
  });
});
