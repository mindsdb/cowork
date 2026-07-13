import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncSettingsToDb } from './syncSettings';

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
