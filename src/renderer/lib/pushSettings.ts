/**
 * Push settings to the cowork-server SQLite database in ONE transactional bulk
 * write.
 *
 * ENG-1127: every client write path (onboarding, MindsHub login, the settings
 * form) now goes through the same endpoint the settings form uses —
 * `PUT /api/v1/settings/` with body `{ values: { db_key: value } }`, applied
 * atomically server-side (all keys or none). The DB is authoritative; the
 * server owns the `.env` export for the standalone `anton` CLI, so the client
 * no longer writes `.env` for settings at all.
 *
 * Callers pass DB-keyed values DIRECTLY. There is no `.env`→DB key map and no
 * provider normalization in the client — the server's SETTING_ENV_ALIASES is
 * the single source of truth for that. The only knowledge shared with the
 * client is the DB setting key names themselves (the settings-API contract).
 */
import { BASE, authFetch } from '../cowork/api';

/**
 * Push a map of DB setting keys → values to the backend via ONE bulk
 * `PUT ${BASE}/settings/` with body `{ values }`.
 *
 * Returns true on a 2xx response (or when `values` is empty — nothing to
 * write, so vacuously successful and no request is made), false if the write
 * was rejected or the server was unreachable. Callers may use this to decide
 * whether to retry or defer.
 */
export async function pushSettingsToDb(values: Record<string, string>): Promise<boolean> {
  // Nothing to persist → vacuously successful, no request (matches the old
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
  values: Record<string, string>,
  attempts = 3,
  baseDelayMs = 500,
): Promise<boolean> {
  const n = Math.max(1, attempts);
  for (let i = 0; i < n; i++) {
    if (await pushSettingsToDb(values)) return true;
    if (i < n - 1 && baseDelayMs > 0) await sleep(baseDelayMs * 2 ** i);
  }
  return false;
}
