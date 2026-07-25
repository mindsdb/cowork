import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchRecommendedModels } from './api';

// The `refresh` flag is the whole mechanism behind "a top-up unlocks paid
// models without restarting the app" (ENG-1001): it's what makes the server
// bypass its 5-minute MindsHub cache. A typo in the query string would leave
// the feature silently inert — every call would still return 200, just with
// the cached `enabled` map — so the URL is worth pinning.

describe('fetchRecommendedModels', () => {
  let calls;

  beforeEach(() => {
    calls = [];
    // tests/setup-env.ts denies network by making fetch throw, so each test
    // installs its own.
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ recommendedModels: { 'minds-cloud': ['sonnet'] } }),
      };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('omits the query string by default, staying cache-eligible', async () => {
    await fetchRecommendedModels();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/settings/recommended-models');
    expect(calls[0]).not.toContain('refresh');
  });

  it('asks the server to bypass its cache when refresh is set', async () => {
    await fetchRecommendedModels({ refresh: true });
    expect(calls[0]).toContain('/settings/recommended-models?refresh=true');
  });

  it('returns the parsed body', async () => {
    const data = await fetchRecommendedModels({ refresh: true });
    expect(data.recommendedModels['minds-cloud']).toEqual(['sonnet']);
  });

  it('returns null on failure so callers keep the lists they have', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await fetchRecommendedModels({ refresh: true })).toBeNull();
  });
});
