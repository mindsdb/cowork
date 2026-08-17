import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncSettingsToDb, syncModelsToDb, syncModelsToDbWithRetry, modelLinesFrom } from './syncSettings';

// syncSettingsToDb PUTs each mapped key to `${BASE}/settings/:key`. We stub
// fetch and inspect which setting keys it wrote.
function settingKeysWritten(calls: any[]): string[] {
  return calls.map(([url]) => String(url).split('/settings/')[1]).filter(Boolean);
}

describe('syncSettingsToDb', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  // ─── ENG-739 regression: models must never be bulk-synced from .env ──
  it('never PUTs planning_model / coding_model, even when present in the lines', async () => {
    await syncSettingsToDb([
      'ANTON_MINDS_API_KEY=mdb_abc',
      'ANTON_PLANNING_PROVIDER=minds-cloud',
      'ANTON_PLANNING_MODEL=latest:sonnet',
      'ANTON_CODING_MODEL=latest:haiku',
    ]);
    const keys = settingKeysWritten(fetchMock.mock.calls);
    expect(keys).not.toContain('planning_model');
    expect(keys).not.toContain('coding_model');
    // The credential + provider still sync (only the model keys are excluded).
    expect(keys).toContain('minds_api_key');
    expect(keys).toContain('planning_provider');
  });

  it('translates a minds-cloud provider to the minds_cloud enum when a minds key is present', async () => {
    await syncSettingsToDb([
      'ANTON_MINDS_API_KEY=mdb_abc',
      'ANTON_PLANNING_PROVIDER=openai-compatible',
    ]);
    const providerCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/settings/planning_provider'));
    expect(providerCall).toBeTruthy();
    expect(JSON.parse((providerCall![1] as any).body).value).toBe('minds_cloud');
  });
});

describe('modelLinesFrom', () => {
  it('returns only the ANTON_*_MODEL lines (BYOK)', () => {
    expect(
      modelLinesFrom([
        'ANTON_OPENAI_API_KEY=sk-x',
        'ANTON_OPENAI_BASE_URL=https://api.openai.com/v1',
        'ANTON_PLANNING_PROVIDER=openai-compatible',
        'ANTON_PLANNING_MODEL=gpt-5.5',
        'ANTON_CODING_MODEL=gpt-5.5-mini',
      ]),
    ).toEqual(['ANTON_PLANNING_MODEL=gpt-5.5', 'ANTON_CODING_MODEL=gpt-5.5-mini']);
  });

  // The minds/SSO path writes no model line (backend resolves the tier default),
  // so there is nothing to hand up / replay on defer.
  it('returns [] when there is no model line (minds/SSO path)', () => {
    expect(
      modelLinesFrom([
        'ANTON_MINDS_API_KEY=mdb_abc',
        'ANTON_PLANNING_PROVIDER=minds-cloud',
      ]),
    ).toEqual([]);
  });

  // Guard: `key in obj` / `obj[key]` also match inherited Object.prototype names.
  it('does not treat inherited prototype names (toString, constructor) as model keys', () => {
    expect(
      modelLinesFrom(['toString=evil', 'constructor=x', 'ANTON_CODING_MODEL=haiku']),
    ).toEqual(['ANTON_CODING_MODEL=haiku']);
  });
});

describe('syncModelsToDb', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('PUTs planning_model + coding_model via the dedicated endpoint', async () => {
    await syncModelsToDb([
      'ANTON_PLANNING_MODEL=gpt-5.5',
      'ANTON_CODING_MODEL=gpt-5.5-mini',
    ]);
    const keys = settingKeysWritten(fetchMock.mock.calls);
    expect(keys).toContain('planning_model');
    expect(keys).toContain('coding_model');
    const planning = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/settings/planning_model'));
    expect(JSON.parse((planning![1] as any).body).value).toBe('gpt-5.5');
  });

  it('ignores non-model keys — it must never write credentials/providers', async () => {
    await syncModelsToDb([
      'ANTON_OPENAI_API_KEY=sk-x',
      'ANTON_PLANNING_PROVIDER=openai-compatible',
      'ANTON_PLANNING_MODEL=gpt-5.5',
    ]);
    const keys = settingKeysWritten(fetchMock.mock.calls);
    expect(keys).toEqual(['planning_model']);
  });

  it('is a no-op when there are no model lines (minds/SSO path)', async () => {
    await syncModelsToDb(['ANTON_MINDS_API_KEY=mdb_abc']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Guard against inherited prototype names resolving to a function via bracket
  // access and producing a garbage PUT.
  it('skips inherited prototype names, writing only real model keys', async () => {
    await syncModelsToDb(['toString=evil', 'constructor=x', 'ANTON_PLANNING_MODEL=gpt-5.5']);
    expect(settingKeysWritten(fetchMock.mock.calls)).toEqual(['planning_model']);
  });

  // #455 review: callers must be able to tell a write succeeded before dropping
  // their retry payload — a lost model write is not self-healing.
  it('returns true when every model PUT is 2xx', async () => {
    expect(await syncModelsToDb(['ANTON_PLANNING_MODEL=gpt-5.5'])).toBe(true);
  });

  it('returns false when a model PUT is not 2xx', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    expect(await syncModelsToDb(['ANTON_PLANNING_MODEL=gpt-5.5'])).toBe(false);
  });

  it('returns true (vacuously) when there is nothing to write', async () => {
    expect(await syncModelsToDb(['ANTON_MINDS_API_KEY=mdb_abc'])).toBe(true);
  });

  // ENG-1358: the server now refuses a model id the live catalog doesn't list.
  // That refusal is permanent — retrying it forever would strand onboarding on
  // a write that can never succeed, so it must NOT read as a transient failure.
  it('treats a 400 rejection as permanent, not a retryable failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    expect(await syncModelsToDb(['ANTON_PLANNING_MODEL=deepseek-v4-flash'])).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('deepseek-v4-flash'));
    warn.mockRestore();
  });

  it('still reports a 5xx as a retryable failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    expect(await syncModelsToDb(['ANTON_PLANNING_MODEL=gpt-5.5'])).toBe(false);
  });

  // Only 400/422 mean "the server refused this VALUE". A 401 is an auth state a
  // later attempt can clear, so treating the whole 4xx class as permanent would
  // silently drop a model write that would have succeeded. 401 is also the only
  // other 4xx actually reachable on this route.
  it('treats a 401 as retryable, not a permanent refusal', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    expect(await syncModelsToDb(['ANTON_PLANNING_MODEL=gpt-5.5'])).toBe(false);
  });

  it('treats a 422 as a permanent refusal, like 400', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 422 });
    expect(await syncModelsToDb(['ANTON_PLANNING_MODEL=bad'])).toBe(true);
    warn.mockRestore();
  });
});

describe('syncModelsToDbWithRetry', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('recovers from a transient failure (fails once, then succeeds on retry)', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false } as Response) // attempt 1
      .mockResolvedValue({ ok: true } as Response);      // retry
    expect(await syncModelsToDbWithRetry(['ANTON_PLANNING_MODEL=gpt-5.5'], 3, 0)).toBe(true);
  });

  it('returns false after exhausting all attempts', async () => {
    fetchMock.mockResolvedValue({ ok: false } as Response);
    expect(await syncModelsToDbWithRetry(['ANTON_PLANNING_MODEL=gpt-5.5'], 2, 0)).toBe(false);
  });

  it('returns true without any request when there is nothing to write', async () => {
    expect(await syncModelsToDbWithRetry(['ANTON_MINDS_API_KEY=x'])).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
