// Mock analytics before importing the adapter to test once-per-receipt credit impressions; the
// general reducer tests use real analytics.
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
    // Included-allowance exhaustion is still a credit-block impression, including users never
    // topped up.
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
