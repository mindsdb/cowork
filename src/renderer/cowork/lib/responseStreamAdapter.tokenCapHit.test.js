// ENG-385 / ENG-1533 / ENG-1537: the credit-block impression fires here, on
// receipt of the failure event, and not in the render path (ChatView re-runs
// every paint). It lives in its own file because the gate reads a binding
// imported at module load, so the analytics mock has to be hoisted above the
// adapter's import — and responseStreamAdapter.test.js deliberately runs
// against the real analytics module.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { trackTokenCapHit, trackArtifactBuilt } = vi.hoisted(() => ({
  trackTokenCapHit: vi.fn(),
  trackArtifactBuilt: vi.fn(),
}));
vi.mock('./analytics', () => ({ trackTokenCapHit, trackArtifactBuilt }));

import { initialStreamState, reduceStream } from './responseStreamAdapter';

const failed = (code) => ({ type: 'response.failed', code, error: 'blocked' });
const fire = (code, opts) => reduceStream(initialStreamState(), failed(code), Date.now, opts);

beforeEach(() => {
  trackTokenCapHit.mockClear();
});

describe('token_cap_hit impression on a credit block', () => {
  it('fires once for a drained wallet, tagged with the reason', () => {
    fire('token_limit');
    expect(trackTokenCapHit).toHaveBeenCalledTimes(1);
    expect(trackTokenCapHit).toHaveBeenCalledWith('token_limit');
  });

  it('fires for a spent free allowance — the cohort the metric exists to measure (ENG-1537)', () => {
    // Splitting this into its own code silently dropped it from the metric,
    // and a never-topped-up org is precisely who `_enabled_aware_default`
    // steers onto the free-bucket model.
    fire('included_allowance_exhausted');
    expect(trackTokenCapHit).toHaveBeenCalledTimes(1);
    expect(trackTokenCapHit).toHaveBeenCalledWith('included_allowance_exhausted');
  });

  it('fires for model_access_denied too — its card was an impression with no event (ENG-1533)', () => {
    fire('model_access_denied');
    expect(trackTokenCapHit).toHaveBeenCalledTimes(1);
    expect(trackTokenCapHit).toHaveBeenCalledWith('model_access_denied');
  });

  it('does NOT fire for a velocity limit (rate_limited)', () => {
    // A rate limit was never upgrade intent — counting it would inflate the
    // signal with users who already pay.
    fire('rate_limited');
    expect(trackTokenCapHit).not.toHaveBeenCalled();
  });

  it('does NOT fire for model_disabled — an admin turned the model off, credits do not unlock it', () => {
    fire('model_disabled');
    expect(trackTokenCapHit).not.toHaveBeenCalled();
  });

  it('does NOT fire for free_serving_paused, a fleet-wide pause of free Air rather than this user\'s cap', () => {
    // The daily spend fuse stops every unfunded org at once. Counting it would
    // book a spike of cap hits that no user's own usage caused.
    const state = fire('free_serving_paused');
    expect(trackTokenCapHit).not.toHaveBeenCalled();
    // Still a failed turn, so the card renders.
    expect(state.errorCode).toBe('free_serving_paused');
  });

  it('does NOT fire for model_restricted, an org admin\'s model rule that credits do not unlock', () => {
    const state = fire('model_restricted');
    expect(trackTokenCapHit).not.toHaveBeenCalled();
    expect(state.errorCode).toBe('model_restricted');
  });

  it('does NOT fire for an unrelated failure code', () => {
    fire('provider_overloaded');
    expect(trackTokenCapHit).not.toHaveBeenCalled();
  });

  it('does NOT fire on replay, so reloading a conversation cannot inflate the count', () => {
    fire('token_limit', { replay: true });
    fire('included_allowance_exhausted', { replay: true });
    fire('model_access_denied', { replay: true });
    expect(trackTokenCapHit).not.toHaveBeenCalled();
  });

  it('still records the error on the state when analytics throws', () => {
    trackTokenCapHit.mockImplementationOnce(() => { throw new Error('posthog down'); });
    const state = fire('token_limit');
    expect(state.status).toBe('error');
    expect(state.errorCode).toBe('token_limit');
  });
});
