/**
 * Push settings to the cowork-server SQLite DB in ONE transactional bulk write.
 *
 * ENG-1127: every client write path (onboarding, MindsHub login, settings form)
 * uses `PUT /api/v1/settings/` with body `{ values: { db_key: value } }`,
 * applied atomically server-side. The client no longer writes `.env` and passes
 * DB-keyed values DIRECTLY — no `.env`→DB key map, no provider normalization
 * (the server owns that).
 */
import { BASE, authFetch } from '../cowork/api';

/**
 * Bulk `PUT ${BASE}/settings/` with body `{ values }`. Returns true on a 2xx
 * (or when `values` is empty — nothing to write, vacuously true, no request),
 * false if rejected or the server was unreachable.
 */
export async function pushSettingsToDb(values: Record<string, string>): Promise<boolean> {
  // Nothing to persist → vacuously true, no request.
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
 * pushSettingsToDb with retries + exponential backoff for the single
 * post-install push (ENG-1127) — on a fresh install the server has just started,
 * so a lone failure is usually a transient blip. On false (all attempts failed)
 * the caller MUST keep its payload and route to a retryable error rather than
 * strand a fresh install config-not-ready. `baseDelayMs` is 0 in tests.
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
