import { describe, it, expect, vi, beforeEach } from 'vitest';

// Wiring tests for the analytics side-effects the reducer fires on terminal
// events (ENG-736 first_response, plus the existing token-cap / artifact
// signals). Kept in a separate file so mocking './analytics' stays isolated
// from responseStreamAdapter.test.js, which exercises the pure reduction.
const { trackFirstResponse, trackTokenCapHit, trackArtifactBuilt } = vi.hoisted(() => ({
  trackFirstResponse: vi.fn(),
  trackTokenCapHit: vi.fn(),
  trackArtifactBuilt: vi.fn(),
}));
vi.mock('./analytics', () => ({ trackFirstResponse, trackTokenCapHit, trackArtifactBuilt }));

// Imported after the mock is registered (vi.mock is hoisted above imports).
const { reduceStream, initialStreamState } = await import('./responseStreamAdapter');

const now = () => 1000;

beforeEach(() => {
  trackFirstResponse.mockClear();
  trackTokenCapHit.mockClear();
  trackArtifactBuilt.mockClear();
});

describe('first_response activation gate wiring (ENG-736)', () => {
  it('fires trackFirstResponse("success") on response.completed', () => {
    reduceStream(initialStreamState(), { type: 'response.completed' }, now);
    expect(trackFirstResponse).toHaveBeenCalledTimes(1);
    expect(trackFirstResponse).toHaveBeenCalledWith('success');
  });

  it('fires trackFirstResponse("error", code) with the failure reason on response.failed', () => {
    reduceStream(
      initialStreamState(),
      { type: 'response.failed', code: 'model_access_denied', error: 'nope' },
      now,
    );
    expect(trackFirstResponse).toHaveBeenCalledWith('error', 'model_access_denied');
  });

  it('passes "unknown" when a failure carries no code', () => {
    reduceStream(initialStreamState(), { type: 'response.failed', error: 'boom' }, now);
    expect(trackFirstResponse).toHaveBeenCalledWith('error', 'unknown');
  });

  it('does not fire on replay (historical reload must not re-emit activation)', () => {
    reduceStream(initialStreamState(), { type: 'response.completed' }, now, { replay: true });
    reduceStream(
      initialStreamState(),
      { type: 'response.failed', code: 'model_access_denied' },
      now,
      { replay: true },
    );
    expect(trackFirstResponse).not.toHaveBeenCalled();
  });
});
