import { describe, it, expect, vi, afterEach } from 'vitest';

// minds-urls computes its exports once at module load (from
// MINDS_API_HOST env > baked build-channel value > prod fallback), so each
// case re-imports a fresh copy under a controlled env. build-channel.gen
// does not exist in the test env, so the baked branch always resolves ''.
async function loadWithEnv(apiHost?: string) {
  vi.resetModules();
  const prev = process.env.MINDS_API_HOST;
  if (apiHost === undefined) {
    delete process.env.MINDS_API_HOST;
  } else {
    process.env.MINDS_API_HOST = apiHost;
  }
  try {
    return await import('./minds-urls');
  } finally {
    if (prev === undefined) {
      delete process.env.MINDS_API_HOST;
    } else {
      process.env.MINDS_API_HOST = prev;
    }
  }
}

afterEach(() => {
  vi.resetModules();
});

// The prod lock: a build with nothing baked and nothing overridden MUST
// resolve every MindsHub surface to production. Staging/dev targeting is
// always an explicit opt-in (baked minds_api_url or env override) — never
// a default a prod user could fall into, and never something a non-prod
// value can leak into prod through.
describe('prod defaults (nothing baked, no env override)', () => {
  it('resolves every host to production', async () => {
    const m = await loadWithEnv(undefined);
    expect(m.MINDS_API_HOST).toBe('https://api.mindshub.ai');
    expect(m.MINDS_AUTH_HOST).toBe('https://auth.mindshub.ai');
    expect(m.MINDS_CONSOLE_HOST).toBe('https://console.mindshub.ai');
    expect(m.MINDS_KEYCLOAK_BASE).toBe('https://auth.mindshub.ai/auth');
    expect(m.MINDS_AUTH_SERVICE_URL).toBe('https://auth.mindshub.ai/v1');
    expect(m.MINDS_LLM_BASE_URL).toBe('https://api.mindshub.ai/v1');
  });

  it('reports no env slug, so the spawned server is not stamped with ENV', async () => {
    const m = await loadWithEnv(undefined);
    expect(m.MINDS_ENV_SLUG).toBe('');
  });
});

describe('staging/dev builds derive the whole host family from the API host', () => {
  it('staging API host yields staging auth + console + slug', async () => {
    const m = await loadWithEnv('https://api.staging.mindshub.ai');
    expect(m.MINDS_AUTH_HOST).toBe('https://auth.staging.mindshub.ai');
    expect(m.MINDS_CONSOLE_HOST).toBe('https://console.staging.mindshub.ai');
    expect(m.MINDS_KEYCLOAK_BASE).toBe('https://auth.staging.mindshub.ai/auth');
    expect(m.MINDS_ENV_SLUG).toBe('staging');
  });

  it('dev API host yields dev auth + slug', async () => {
    const m = await loadWithEnv('https://api.dev.mindshub.ai');
    expect(m.MINDS_AUTH_HOST).toBe('https://auth.dev.mindshub.ai');
    expect(m.MINDS_ENV_SLUG).toBe('dev');
  });

  it('normalizes a value carrying a path or trailing slash to a bare origin', async () => {
    const m = await loadWithEnv('https://api.staging.mindshub.ai/v1/');
    expect(m.MINDS_API_HOST).toBe('https://api.staging.mindshub.ai');
    expect(m.MINDS_AUTH_HOST).toBe('https://auth.staging.mindshub.ai');
  });

  it('a non-mindshub host produces no env slug (never stamps ENV from foreign URLs)', async () => {
    const m = await loadWithEnv('https://api.example.com');
    expect(m.MINDS_ENV_SLUG).toBe('');
  });
});
