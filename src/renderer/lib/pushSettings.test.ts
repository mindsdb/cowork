import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pushSettingsToDb, pushSettingsToDbWithRetry } from './pushSettings';

// pushSettingsToDb does ONE bulk PUT to `${BASE}/settings/` with `{ values }`.
// Callers pass DB-keyed values directly — no `.env`→DB map, no normalization —
// so these assert the object is sent through verbatim.
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

  it('does ONE bulk PUT to /settings/ with the exact {values} — not a per-key loop', async () => {
    const values = {
      anthropic_api_key: 'sk-ant',
      planning_provider: 'anthropic',
      coding_provider: 'anthropic',
    };
    await pushSettingsToDb(values);
    // Exactly one request, and it targets the collection endpoint (bulk PUT).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/settings\/$/);
    expect((opts as any).method).toBe('PUT');
    const body = JSON.parse((opts as any).body);
    expect(body).toHaveProperty('values');
    // Sent verbatim — no mapping, no key renaming.
    expect(body.values).toEqual(values);
  });

  it('sends DB-keyed values through untouched — no normalization of provider enums or models', async () => {
    const values = {
      openai_api_key: 'sk-x',
      openai_base_url: 'http://localhost:11434/v1',
      planning_provider: 'openai_compatible',
      coding_provider: 'openai_compatible',
      planning_model: 'llama-3.3-70b',
      coding_model: 'llama-3.3-70b',
    };
    await pushSettingsToDb(values);
    // Carried exactly as given — no rewrite of `openai_compatible`, no second
    // model write, no re-tag to minds_cloud.
    expect(lastPutValues(fetchMock.mock.calls)).toEqual(values);
  });

  it('does not fetch at all when values is empty, and returns true (vacuous)', async () => {
    expect(await pushSettingsToDb({})).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns true on a 2xx and false on a non-2xx', async () => {
    expect(await pushSettingsToDb({ minds_api_key: 'x' })).toBe(true);
    fetchMock.mockResolvedValue({ ok: false } as Response);
    expect(await pushSettingsToDb({ minds_api_key: 'x' })).toBe(false);
  });

  it('returns false when fetch rejects (server unreachable)', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    expect(await pushSettingsToDb({ minds_api_key: 'x' })).toBe(false);
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
    expect(await pushSettingsToDbWithRetry({ minds_api_key: 'x' }, 3, 0)).toBe(true);
  });

  it('returns false after exhausting all attempts', async () => {
    fetchMock.mockResolvedValue({ ok: false } as Response);
    expect(await pushSettingsToDbWithRetry({ minds_api_key: 'x' }, 2, 0)).toBe(false);
  });

  it('returns true without any request when there is nothing to write', async () => {
    expect(await pushSettingsToDbWithRetry({})).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
