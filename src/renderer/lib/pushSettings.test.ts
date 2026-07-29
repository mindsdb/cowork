import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pushSettingsToDb, pushSettingsToDbWithRetry } from './pushSettings';

// pushSettingsToDb does ONE bulk PUT to `${BASE}/settings/` with body
// `{ values: { db_key: value } }`. We stub fetch and inspect that single call.
function lastPutValues(calls: any[]): Record<string, string> {
  const put = calls.find(([, opts]) => opts?.method === 'PUT');
  if (!put) return {};
  return JSON.parse((put[1] as any).body).values;
}

describe('pushSettingsToDb', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('does ONE bulk PUT to /settings/ with the mapped {values} — not a per-key loop', async () => {
    await pushSettingsToDb([
      'ANTON_ANTHROPIC_API_KEY=sk-ant',
      'ANTON_PLANNING_PROVIDER=anthropic',
      'ANTON_CODING_PROVIDER=anthropic',
    ]);
    // Exactly one request, and it targets the collection endpoint (bulk PUT).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/settings\/$/);
    expect((opts as any).method).toBe('PUT');
    const body = JSON.parse((opts as any).body);
    expect(body).toHaveProperty('values');
    expect(body.values).toEqual({
      anthropic_api_key: 'sk-ant',
      planning_provider: 'anthropic',
      coding_provider: 'anthropic',
    });
  });

  // ENG-1127: models now ride the SAME bulk write (the ENG-739 split collapsed).
  it('includes planning_model / coding_model in the same bulk write', async () => {
    await pushSettingsToDb([
      'ANTON_OPENAI_API_KEY=sk-x',
      'ANTON_OPENAI_BASE_URL=http://localhost:11434/v1',
      'ANTON_PLANNING_PROVIDER=openai-compatible',
      'ANTON_CODING_PROVIDER=openai-compatible',
      'ANTON_PLANNING_MODEL=llama-3.3-70b',
      'ANTON_CODING_MODEL=llama-3.3-70b',
    ]);
    const values = lastPutValues(fetchMock.mock.calls);
    expect(values.planning_model).toBe('llama-3.3-70b');
    expect(values.coding_model).toBe('llama-3.3-70b');
    // Provider normalization: no minds key present → hyphen→underscore only.
    expect(values.planning_provider).toBe('openai_compatible');
  });

  it('translates a provider to the minds_cloud enum when a minds key is present', async () => {
    await pushSettingsToDb([
      'ANTON_MINDS_API_KEY=mdb_abc',
      'ANTON_PLANNING_PROVIDER=openai-compatible',
      'ANTON_CODING_PROVIDER=minds-cloud',
    ]);
    const values = lastPutValues(fetchMock.mock.calls);
    expect(values.minds_api_key).toBe('mdb_abc');
    // openai-compatible + a minds key ⇒ minds_cloud …
    expect(values.planning_provider).toBe('minds_cloud');
    // … and a plain hyphenated value is underscored.
    expect(values.coding_provider).toBe('minds_cloud');
  });

  it('ignores unmapped keys (TERMS_CONSENT, MINDS_ENABLED)', async () => {
    await pushSettingsToDb([
      'ANTON_TERMS_CONSENT=true',
      'ANTON_MINDS_ENABLED=true',
      'ANTON_MINDS_API_KEY=mdb_abc',
    ]);
    const values = lastPutValues(fetchMock.mock.calls);
    expect(values).toEqual({ minds_api_key: 'mdb_abc' });
  });

  // Guard: `key in obj` / bracket access also match inherited Object.prototype
  // names — a stray `toString=…` line must not become a garbage PUT.
  it('does not treat inherited prototype names (toString, constructor) as setting keys', async () => {
    await pushSettingsToDb(['toString=evil', 'constructor=x', 'ANTON_CODING_MODEL=haiku']);
    const values = lastPutValues(fetchMock.mock.calls);
    expect(values).toEqual({ coding_model: 'haiku' });
  });

  it('does not fetch at all when nothing maps, and returns true (vacuous)', async () => {
    expect(await pushSettingsToDb(['ANTON_TERMS_CONSENT=true'])).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns true on a 2xx and false on a non-2xx', async () => {
    expect(await pushSettingsToDb(['ANTON_MINDS_API_KEY=x'])).toBe(true);
    fetchMock.mockResolvedValue({ ok: false } as Response);
    expect(await pushSettingsToDb(['ANTON_MINDS_API_KEY=x'])).toBe(false);
  });

  it('returns false when fetch rejects (server unreachable)', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    expect(await pushSettingsToDb(['ANTON_MINDS_API_KEY=x'])).toBe(false);
  });
});

describe('pushSettingsToDbWithRetry', () => {
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
    expect(await pushSettingsToDbWithRetry(['ANTON_MINDS_API_KEY=x'], 3, 0)).toBe(true);
  });

  it('returns false after exhausting all attempts', async () => {
    fetchMock.mockResolvedValue({ ok: false } as Response);
    expect(await pushSettingsToDbWithRetry(['ANTON_MINDS_API_KEY=x'], 2, 0)).toBe(false);
  });

  it('returns true without any request when there is nothing to write', async () => {
    expect(await pushSettingsToDbWithRetry(['ANTON_TERMS_CONSENT=true'])).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
