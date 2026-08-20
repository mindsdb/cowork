/**
 * Sync .env-style settings lines to the cowork-server SQLite database.
 *
 * The DB is authoritative for cowork-server — .env is a legacy layer for
 * the standalone `anton` CLI and Electron's main process. Any code that
 * writes to .env (host.saveSettings) should also call one of these
 * helpers so the DB stays in sync.
 */
import { BASE, authFetch } from '../cowork/api';

// Env-var names (ANTON_FOO_BAR) → backend DB setting keys (foo_bar).
const ENV_TO_SETTING: Record<string, string> = {
  ANTON_ANTHROPIC_API_KEY: 'anthropic_api_key',
  ANTON_OPENAI_API_KEY: 'openai_api_key',
  ANTON_OPENAI_BASE_URL: 'openai_base_url',
  ANTON_MINDS_API_KEY: 'minds_api_key',
  ANTON_MINDS_URL: 'minds_url',
  ANTON_PLANNING_PROVIDER: 'planning_provider',
  ANTON_CODING_PROVIDER: 'coding_provider',
  // ANTON_PLANNING_MODEL / ANTON_CODING_MODEL are deliberately absent (ENG-739).
  // This helper runs on every login, post-install, and web token-refresh from
  // the *full* .env, so mapping the model keys here re-pins a user who just
  // recovered via the picker (their .env still holds the legacy `latest:` line,
  // which we now preserve). Models enter the DB only via explicit writes —
  // the Settings picker, or onboarding's dedicated model PUT. .env model lines
  // are CLI-only.
  ANTON_MEMORY_MODE: 'memory_mode',
  ANTON_EPISODIC_MEMORY: 'episodic_memory',
};

/**
 * Push an array of "KEY=value" lines to the backend DB via PUT /settings/:key.
 *
 * Handles the provider-enum translation (hyphens → underscores, detection of
 * minds_cloud vs openai_compatible).
 *
 * Returns true if every mapped PUT succeeded (2xx), false if any failed or
 * the server was unreachable. Callers may use this to decide whether to retry
 * or fall back to another recovery path.
 */
export async function syncSettingsToDb(lines: string[]): Promise<boolean> {
  const envMap: Record<string, string> = {};
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    envMap[line.slice(0, eq)] = line.slice(eq + 1);
  }
  const hasMindKey = Boolean(envMap.ANTON_MINDS_API_KEY);

  let allOk = true;
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
      const res = await authFetch(`${BASE}/settings/${encodeURIComponent(settingKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: dbValue }),
      });
      if (!res.ok) allOk = false;
    } catch {
      allOk = false;
    }
  }
  return allOk;
}

// Model env keys → their dedicated DB setting keys. Intentionally SEPARATE from
// ENV_TO_SETTING (ENG-739): models must NEVER ride the bulk .env re-sync, or a
// routine login/token-refresh would re-pin a picker choice from the stale .env
// `latest:` line. See the ENG-739 note on ENV_TO_SETTING above.
const MODEL_ENV_TO_SETTING: Record<string, string> = {
  ANTON_PLANNING_MODEL: 'planning_model',
  ANTON_CODING_MODEL: 'coding_model',
};

// Own-key check — NOT `key in MODEL_ENV_TO_SETTING` / bracket access, which also
// match inherited Object.prototype names (`toString`, `constructor`, …) and
// would treat a stray `toString=…` line as a model key with a function value.
const isModelEnvKey = (key: string): boolean =>
  Object.prototype.hasOwnProperty.call(MODEL_ENV_TO_SETTING, key);

/** The `ANTON_*_MODEL` lines from a set of "KEY=value" lines. */
export function modelLinesFrom(lines: string[]): string[] {
  return lines.filter((l) => {
    const eq = l.indexOf('=');
    return eq > 0 && isModelEnvKey(l.slice(0, eq));
  });
}

/**
 * Explicitly write the model chosen during onboarding to the DB via the
 * dedicated PUT /settings/:key — the ONLY non-picker path allowed to set a model
 * (ENG-739). Callers must invoke this only for a genuine explicit choice
 * (onboarding), NEVER from the recurring login/post-install/token-refresh bulk
 * sync — doing so would reopen the ENG-739 picker-clobber. A minds onboarding
 * writes no model line, so this is a vacuous success there (the backend resolves
 * the tier-aware default). Kept alongside syncSettingsToDb so both model-write
 * and bulk-write logic live in one place (ENG-922).
 *
 * Returns true when every model PUT it attempted either succeeded or was
 * REFUSED on its merits (400/422 — see the branch below), and false only when a
 * write may still land on a retry. Callers MUST check this before dropping their
 * retry payload: a *lost* model write is not self-healing — model keys are
 * excluded from the bulk .env re-sync (ENG-739) AND the backend's startup
 * migration, so a silently dropped write leaves a fresh install permanently
 * config-not-ready (#455 review). A refused one is different in kind: retrying
 * it can never succeed, and the value was rejected precisely because it wouldn't
 * have worked.
 */
export async function syncModelsToDb(lines: string[]): Promise<boolean> {
  let allOk = true;
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const envKey = line.slice(0, eq);
    if (!isModelEnvKey(envKey)) continue;
    const settingKey = MODEL_ENV_TO_SETTING[envKey];
    const value = line.slice(eq + 1);
    if (!value) continue;
    try {
      const res = await authFetch(`${BASE}/settings/${encodeURIComponent(settingKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      // 400 / 422 are the server REFUSING this value on its merits — for a
      // model key, an id absent from the live catalog (ENG-1358). Permanent, so
      // retrying burns the backoff and then strands the caller holding a payload
      // that can never succeed. Treat it as handled and move on.
      //
      // Deliberately NOT the whole 4xx class: 401 in particular is an auth state
      // that a later attempt can clear, and treating it as permanent would
      // silently drop a model write that would have succeeded. Everything else —
      // other 4xx, 5xx, or a response with no usable status — stays retryable,
      // preserving the #455 contract that a genuinely lost write is reported.
      const status = typeof res.status === 'number' ? res.status : 0;
      if (!res.ok) {
        if (status === 400 || status === 422) {
          // The row is left as it was: unset on a fresh install (the backend
          // then resolves its provider default, a working config), or the
          // PREVIOUS id if one was already stored — which for an install
          // already holding a bad model means it stays bad until the user
          // changes it in Settings. The turn-time card is what surfaces that.
          console.warn(
            `[settings] server refused ${settingKey}="${value}" (${status}) — ` +
            'not retrying; the stored value is unchanged',
          );
        } else {
          allOk = false;
        }
      }
    } catch {
      allOk = false;
    }
  }
  return allOk;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * syncModelsToDb with a few retries and exponential backoff — for the
 * post-install replay (ENG-922). The cowork-server has just been
 * installed/started, so a lone failed request is usually a transient settling
 * blip; the backoff gives it a moment to come up rather than hammering it
 * back-to-back (#455 review). Returns true once a full write succeeds, is
 * refused on its merits (400/422 — permanent, so no retry can help), or there's
 * nothing to write; false if every attempt failed for a reason a retry might
 * still clear — on false the caller MUST keep its retry payload (see the
 * syncModelsToDb note on why a lost model write doesn't self-heal).
 * `baseDelayMs` is 0 in tests to keep them fast.
 */
export async function syncModelsToDbWithRetry(
  lines: string[],
  attempts = 3,
  baseDelayMs = 500,
): Promise<boolean> {
  const n = Math.max(1, attempts);
  for (let i = 0; i < n; i++) {
    if (await syncModelsToDb(lines)) return true;
    if (i < n - 1 && baseDelayMs > 0) await sleep(baseDelayMs * 2 ** i);
  }
  return false;
}
