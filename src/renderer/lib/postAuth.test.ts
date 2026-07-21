import { describe, it, expect, vi } from 'vitest';
import { runPostAuthHandshake, type PostAuthDeps } from './postAuth';

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

  it('a thrown bulk sync keeps the payload (does not clear on a degraded terminal)', async () => {
    const deps = makeDeps({
      deferredModelLines: ['ANTON_PLANNING_MODEL=gpt-5.5'],
      syncSettingsToDb: vi.fn(async () => { throw new Error('offline'); }),
    });
    expect(await runPostAuthHandshake(deps)).toEqual({ next: 'terminal', clearDeferred: false });
  });
});
