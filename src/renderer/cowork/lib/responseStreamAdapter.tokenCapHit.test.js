// ENG-1537: the upgrade-intent signal must follow the out-of-credits codes.
// Its own file because the gate reads a binding imported at module load, so the
// mock has to be hoisted above the adapter's import.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const trackTokenCapHit = vi.fn();
vi.mock('./analytics', () => ({
  trackTokenCapHit: (...a) => trackTokenCapHit(...a),
  trackArtifactBuilt: vi.fn(),
}));

const { initialStreamState, reduceStream } = await import('./responseStreamAdapter');

describe('token_cap_hit follows the out-of-credits codes', () => {
  beforeEach(() => trackTokenCapHit.mockClear());

  const fire = (code, opts) =>
    reduceStream(initialStreamState(), { type: 'response.failed', code, error: 'x' },
      Date.now, opts);

  it('fires for a drained wallet', () => {
    fire('token_limit');
    expect(trackTokenCapHit).toHaveBeenCalledTimes(1);
  });

  it('fires for a spent free allowance — the cohort it exists to measure', () => {
    // Splitting this into its own code silently dropped it from the metric,
    // and a never-topped-up org is precisely who `_enabled_aware_default`
    // steers onto the free-bucket model.
    fire('included_allowance_exhausted');
    expect(trackTokenCapHit).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire for a velocity limit', () => {
    // A rate limit was never upgrade intent — counting it would inflate the
    // signal with users who already pay.
    fire('rate_limited');
    expect(trackTokenCapHit).not.toHaveBeenCalled();
  });

  it('does not fire on replay', () => {
    fire('token_limit', { replay: true });
    expect(trackTokenCapHit).not.toHaveBeenCalled();
  });
});
