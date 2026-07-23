import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildKind } from './cowork-home';

// minds-urls resolves its host once at module load from:
//   MINDS_API_HOST env > baked build-channel value > build-kind fallback.
// build-channel.gen does not exist in the test env, so the baked branch
// always resolves '' and the fallback (driven by buildKind) decides. Mock
// buildKind so we can drive each branch; a static ESM import is what makes
// it mockable (see minds-urls.ts). Default 'prod' keeps the fallback on the
// production host unless a case says otherwise.
vi.mock('./cowork-home', () => ({ buildKind: vi.fn(() => 'prod') }));

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
  vi.mocked(buildKind).mockReset();
  vi.mocked(buildKind).mockReturnValue('prod');
});

// The prod lock: a PACKAGED prod build with nothing baked and nothing
// overridden MUST resolve every MindsHub surface to production. Staging/dev
// targeting is always explicit (baked minds_api_url, env override, or a
// non-prod build kind) — never a default a prod user could fall into.
describe('prod defaults (prod build kind, nothing baked, no env override)', () => {
  it('resolves every host to production', async () => {
    vi.mocked(buildKind).mockReturnValue('prod');
    const m = await loadWithEnv(undefined);
    expect(m.MINDS_API_HOST).toBe('https://api.mindshub.ai');
    expect(m.MINDS_AUTH_HOST).toBe('https://auth.mindshub.ai');
    expect(m.MINDS_CONSOLE_HOST).toBe('https://console.mindshub.ai');
    expect(m.MINDS_KEYCLOAK_BASE).toBe('https://auth.mindshub.ai/auth');
    expect(m.MINDS_AUTH_SERVICE_URL).toBe('https://auth.mindshub.ai/v1');
    expect(m.MINDS_LLM_BASE_URL).toBe('https://api.mindshub.ai/v1');
  });

  it('reports no env slug, so the spawned server is not stamped with ENV', async () => {
    vi.mocked(buildKind).mockReturnValue('prod');
    const m = await loadWithEnv(undefined);
    expect(m.MINDS_ENV_SLUG).toBe('');
  });

  it('falls back to prod if the build kind cannot be resolved', async () => {
    vi.mocked(buildKind).mockImplementation(() => {
      throw new Error('no electron app');
    });
    const m = await loadWithEnv(undefined);
    expect(m.MINDS_API_HOST).toBe('https://api.mindshub.ai');
  });
});

// Local dev (unpackaged → build kind 'dev') and the staging ring must not
// silently target production when nothing is baked.
describe('build-kind fallback (nothing baked, no env override)', () => {
  it('dev build kind targets the dev environment', async () => {
    vi.mocked(buildKind).mockReturnValue('dev');
    const m = await loadWithEnv(undefined);
    expect(m.MINDS_API_HOST).toBe('https://api.staging.mindshub.ai');
    expect(m.MINDS_AUTH_HOST).toBe('https://auth.staging.mindshub.ai');
    expect(m.MINDS_KEYCLOAK_BASE).toBe('https://auth.staging.mindshub.ai/auth');
    expect(m.MINDS_ENV_SLUG).toBe('staging');
  });

  it('preview and stable build kinds target staging', async () => {
    vi.mocked(buildKind).mockReturnValue('preview');
    let m = await loadWithEnv(undefined);
    expect(m.MINDS_API_HOST).toBe('https://api.staging.mindshub.ai');
    expect(m.MINDS_ENV_SLUG).toBe('staging');

    vi.mocked(buildKind).mockReturnValue('stable');
    m = await loadWithEnv(undefined);
    expect(m.MINDS_AUTH_HOST).toBe('https://auth.staging.mindshub.ai');
  });

  it('an explicit MINDS_API_HOST beats the build-kind fallback', async () => {
    vi.mocked(buildKind).mockReturnValue('dev');
    const m = await loadWithEnv('https://api.mindshub.ai');
    expect(m.MINDS_API_HOST).toBe('https://api.mindshub.ai');
    expect(m.MINDS_ENV_SLUG).toBe('');
  });
});

describe('explicit host overrides derive the whole family', () => {
  it('staging API host yields staging auth + console + slug', async () => {
    const m = await loadWithEnv('https://api.staging.mindshub.ai');
    expect(m.MINDS_AUTH_HOST).toBe('https://auth.staging.mindshub.ai');
    expect(m.MINDS_CONSOLE_HOST).toBe('https://console.staging.mindshub.ai');
    expect(m.MINDS_KEYCLOAK_BASE).toBe('https://auth.staging.mindshub.ai/auth');
    expect(m.MINDS_ENV_SLUG).toBe('staging');
  });

  it('dev API host yields dev auth + slug', async () => {
    const m = await loadWithEnv('https://api.staging.mindshub.ai');
    expect(m.MINDS_AUTH_HOST).toBe('https://auth.staging.mindshub.ai');
    expect(m.MINDS_ENV_SLUG).toBe('staging');
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
