// ENG-385 / ENG-1533: the credit-block impression fires here, on receipt of the
// failure event, and not in the render path (ChatView re-runs every paint). It
// lives in its own file because the assertion needs the analytics module mocked,
// and responseStreamAdapter.test.js deliberately runs against the real one.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { trackTokenCapHit, trackArtifactBuilt } = vi.hoisted(() => ({
  trackTokenCapHit: vi.fn(),
  trackArtifactBuilt: vi.fn(),
}));
vi.mock('./analytics', () => ({ trackTokenCapHit, trackArtifactBuilt }));

import { initialStreamState, reduceStream } from './responseStreamAdapter';

const failed = (code) => ({ type: 'response.failed', code, error: 'blocked' });

beforeEach(() => {
  trackTokenCapHit.mockClear();
});

describe('token_cap_hit impression on a credit block', () => {
  it('fires once for token_limit, tagged with the code', () => {
    reduceStream(initialStreamState(), failed('token_limit'));
    expect(trackTokenCapHit).toHaveBeenCalledTimes(1);
    expect(trackTokenCapHit).toHaveBeenCalledWith('token_limit');
  });

  it('fires for model_access_denied too — its card was an impression with no event (ENG-1533)', () => {
    reduceStream(initialStreamState(), failed('model_access_denied'));
    expect(trackTokenCapHit).toHaveBeenCalledTimes(1);
    expect(trackTokenCapHit).toHaveBeenCalledWith('model_access_denied');
  });

  it('does NOT fire for model_disabled — an admin turned the model off, credits do not unlock it', () => {
    reduceStream(initialStreamState(), failed('model_disabled'));
    expect(trackTokenCapHit).not.toHaveBeenCalled();
  });

  it('does NOT fire for an unrelated failure code', () => {
    reduceStream(initialStreamState(), failed('provider_overloaded'));
    expect(trackTokenCapHit).not.toHaveBeenCalled();
  });

  it('does NOT fire on replay, so reloading a conversation cannot inflate the count', () => {
    reduceStream(initialStreamState(), failed('token_limit'), Date.now, { replay: true });
    reduceStream(initialStreamState(), failed('model_access_denied'), Date.now, { replay: true });
    expect(trackTokenCapHit).not.toHaveBeenCalled();
  });

  it('still records the error on the state when analytics throws', () => {
    trackTokenCapHit.mockImplementationOnce(() => { throw new Error('posthog down'); });
    const state = reduceStream(initialStreamState(), failed('token_limit'));
    expect(state.status).toBe('error');
    expect(state.errorCode).toBe('token_limit');
  });
});
