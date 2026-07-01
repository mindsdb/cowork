/**
 * Sync .env-style settings lines to the cowork-server SQLite database.
 *
 * The DB is authoritative for cowork-server — .env is a legacy layer for
 * the standalone `anton` CLI and Electron's main process. Any code that
 * writes to .env (host.saveSettings) should also call one of these
 * helpers so the DB stays in sync.
 */
import { BASE } from '../cowork/api';

// Env-var names (ANTON_FOO_BAR) → backend DB setting keys (foo_bar).
const ENV_TO_SETTING: Record<string, string> = {
  ANTON_ANTHROPIC_API_KEY: 'anthropic_api_key',
  ANTON_OPENAI_API_KEY: 'openai_api_key',
  ANTON_OPENAI_BASE_URL: 'openai_base_url',
  ANTON_MINDS_API_KEY: 'minds_api_key',
  ANTON_MINDS_URL: 'minds_url',
  ANTON_PLANNING_PROVIDER: 'planning_provider',
  ANTON_CODING_PROVIDER: 'coding_provider',
  ANTON_PLANNING_MODEL: 'planning_model',
  ANTON_CODING_MODEL: 'coding_model',
  ANTON_MEMORY_MODE: 'memory_mode',
  ANTON_EPISODIC_MEMORY: 'episodic_memory',
};

/**
 * Push an array of "KEY=value" lines to the backend DB via PUT /settings/:key.
 *
 * Handles the provider-enum translation (hyphens → underscores, detection of
 * minds_cloud vs openai_compatible).
 */
export async function syncSettingsToDb(lines: string[]): Promise<void> {
  const envMap: Record<string, string> = {};
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    envMap[line.slice(0, eq)] = line.slice(eq + 1);
  }
  const hasMindKey = Boolean(envMap.ANTON_MINDS_API_KEY);

  for (const [envKey, value] of Object.entries(envMap)) {
    const settingKey = ENV_TO_SETTING[envKey];
    if (!settingKey) continue;
    let dbValue = value;
    if (settingKey.endsWith('_provider')) {
      if (dbValue === 'openai-compatible' && hasMindKey) {
        dbValue = 'minds_cloud';
      } else {
        dbValue = dbValue.replace(/-/g, '_');
      }
    }
    try {
      await fetch(`${BASE}/settings/${encodeURIComponent(settingKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: dbValue }),
      });
    } catch {
      // Best-effort — .env is the fallback; the backend will pick it
      // up on next restart even if this call fails.
    }
  }
}
