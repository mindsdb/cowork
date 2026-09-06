/**
 * cowork-server's DB is authoritative; .env remains for the CLI and main process. Pair
 * host.saveSettings with DB sync.
 */
import { BASE, authFetch } from '../cowork/api';
import { mindsServesOpenAiCompatible } from '../../shared/minds-endpoint';

// Env-var names (ANTON_FOO_BAR) → backend DB setting keys (foo_bar).
const ENV_TO_SETTING: Record<string, string> = {
  ANTON_ANTHROPIC_API_KEY: 'anthropic_api_key',
  ANTON_OPENAI_API_KEY: 'openai_api_key',
  ANTON_OPENAI_BASE_URL: 'openai_base_url',
  ANTON_MINDS_API_KEY: 'minds_api_key',
  ANTON_MINDS_URL: 'minds_url',
  ANTON_PLANNING_PROVIDER: 'planning_provider',
  ANTON_CODING_PROVIDER: 'coding_provider',
  // Include the router provider so bulk sync restores routing and summarization choices.
  ANTON_ROUTER_PROVIDER: 'router_provider',
  // Exclude model keys from recurring .env sync: stale CLI model lines must not overwrite explicit
  // picker/onboarding choices.
  ANTON_MEMORY_MODE: 'memory_mode',
  ANTON_EPISODIC_MEMORY: 'episodic_memory',
};

/**
 * Pass the OpenAI key because this classification controls routing; see
 * mindsServesOpenAiCompatible.
 */
function isMindsEndpoint(envMap: Record<string, string>): boolean {
  return mindsServesOpenAiCompatible({
    baseUrl: envMap.ANTON_OPENAI_BASE_URL,
    mindsUrl: envMap.ANTON_MINDS_URL,
    openAiApiKey: envMap.ANTON_OPENAI_API_KEY,
  });
}

/**
 * Sync mapped KEY=value lines, translating provider enums. Return false if any mapped PUT fails or
 * cannot reach the server.
 */
export async function syncSettingsToDb(lines: string[]): Promise<boolean> {
  const envMap: Record<string, string> = {};
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    envMap[line.slice(0, eq)] = line.slice(eq + 1);
  }
  // A MindsHub key is necessary but not sufficient to call the endpoint
  // MindsHub -- the base URL is what settles it.
  const mindsIsTheEndpoint =
    Boolean(envMap.ANTON_MINDS_API_KEY) && isMindsEndpoint(envMap);

  let allOk = true;
  for (const [envKey, value] of Object.entries(envMap)) {
    const settingKey = ENV_TO_SETTING[envKey];
    if (!settingKey) continue;
    let dbValue = value;
    if (settingKey.endsWith('_provider')) {
      if (dbValue === 'openai-compatible' && mindsIsTheEndpoint) {
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

// Model writes are explicit-only; never merge these keys into recurring ENV_TO_SETTING sync.
const MODEL_ENV_TO_SETTING: Record<string, string> = {
  ANTON_PLANNING_MODEL: 'planning_model',
  ANTON_CODING_MODEL: 'coding_model',
};

// Exclude inherited keys such as toString and constructor.
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
 * Persist an explicit onboarding model choice; never call from recurring bulk sync. True means
 * every attempted write succeeded or was permanently refused (400/422), or nothing needed writing.
 * False requires retaining the retry payload: bulk sync and startup migration cannot repair a lost
 * model write.
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
      // 400/422 refuse the value permanently and count as handled. Other failures remain retryable,
      // including 401 because later authentication can recover.
      const status = typeof res.status === 'number' ? res.status : 0;
      if (!res.ok) {
        if (status === 400 || status === 422) {
          // A refusal leaves the stored model unchanged; an already-invalid selection still needs
          // user correction.
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
 * Retry transient post-install failures with exponential backoff. False means the caller must
 * retain its model payload; successful or permanently refused writes count as handled. Tests use
 * baseDelayMs=0.
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
