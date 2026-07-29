/**
 * Push .env-style settings lines to the cowork-server SQLite database in ONE
 * transactional bulk write.
 *
 * ENG-1127: every client write path (onboarding, MindsHub login, the settings
 * form) now goes through the same endpoint the settings form uses —
 * `PUT /api/v1/settings/` with body `{ values: { db_key: value } }`, applied
 * atomically server-side (all keys or none). The DB is authoritative; the
 * server mirrors it back out to `.env` for the standalone `anton` CLI, so the
 * client no longer writes `.env` for settings at all.
 */
import { BASE, authFetch } from '../cowork/api';

// Env-var names (ANTON_FOO_BAR) → backend DB setting keys (foo_bar).
//
// ENG-1127: the model keys (planning_model / coding_model) are now folded into
// this single map. The ENG-739 model/bulk split existed only to stop a
// recurring `.env` re-sync from re-pinning a picker choice from a stale
// `latest:` line. With the recurring `.env` re-sync gone, there is no recurring
// push — the only push is an explicit one-time user choice (onboarding / the
// settings form), so writing provider + keys + model together in one bulk PUT
// is correct.
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
 * Push an array of "KEY=value" lines to the backend DB via ONE bulk
 * `PUT ${BASE}/settings/` with body `{ values: { db_key: value } }`.
 *
 * Handles the provider-enum translation (hyphens → underscores, detection of
 * minds_cloud vs openai_compatible). Only keys in ENV_TO_SETTING are mapped;
 * everything else (e.g. ANTON_TERMS_CONSENT, ANTON_MINDS_ENABLED) is ignored.
 *
 * Returns true on a 2xx response (or when there was nothing mapped to write),
 * false if the write was rejected or the server was unreachable. Callers may
 * use this to decide whether to retry or defer.
 */
export async function pushSettingsToDb(lines: string[]): Promise<boolean> {
  const envMap: Record<string, string> = {};
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    envMap[line.slice(0, eq)] = line.slice(eq + 1);
  }
  const hasMindKey = Boolean(envMap.ANTON_MINDS_API_KEY);

  const values: Record<string, string> = {};
  for (const [envKey, value] of Object.entries(envMap)) {
    // Own-property check — NOT `envKey in ENV_TO_SETTING` / bracket access,
    // which also match inherited Object.prototype names (`toString`,
    // `constructor`, …) and would turn a stray `toString=…` line into a PUT
    // with a function-valued setting key.
    if (!Object.prototype.hasOwnProperty.call(ENV_TO_SETTING, envKey)) continue;
    const settingKey = ENV_TO_SETTING[envKey];
    let dbValue = value;
    if (settingKey.endsWith('_provider')) {
      if (dbValue === 'openai-compatible' && hasMindKey) {
        dbValue = 'minds_cloud';
      } else {
        dbValue = dbValue.replace(/-/g, '_');
      }
    }
    values[settingKey] = dbValue;
  }

  // Nothing mapped → nothing to persist. Vacuously successful (matches the old
  // syncSettingsToDb/syncModelsToDb "no writes → true" contract).
  if (Object.keys(values).length === 0) return true;

  try {
    const res = await authFetch(`${BASE}/settings/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * pushSettingsToDb with a few retries and exponential backoff — for the single
 * post-install push (ENG-1127, retry shape reused from the old
 * syncModelsToDbWithRetry). On a fresh install the cowork-server has just been
 * installed/started, so a lone failed request is usually a transient settling
 * blip; the backoff gives it a moment to come up rather than hammering it
 * back-to-back. Returns true once a full write succeeds (or there's nothing to
 * write), false if every attempt failed — on false the caller MUST keep its
 * payload and route to a retryable error rather than strand a fresh install
 * config-not-ready. `baseDelayMs` is 0 in tests to keep them fast.
 */
export async function pushSettingsToDbWithRetry(
  lines: string[],
  attempts = 3,
  baseDelayMs = 500,
): Promise<boolean> {
  const n = Math.max(1, attempts);
  for (let i = 0; i < n; i++) {
    if (await pushSettingsToDb(lines)) return true;
    if (i < n - 1 && baseDelayMs > 0) await sleep(baseDelayMs * 2 ** i);
  }
  return false;
}
