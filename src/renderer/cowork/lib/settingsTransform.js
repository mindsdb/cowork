/**
 * Settings translation layer — pure functions, no network calls.
 *
 * Translates between the three representations of settings data:
 *
 *   1. **Server (DB)**: snake_case keys, string values, sensitive fields
 *      returned as {is_sensitive: true, is_set: bool} without the value.
 *      Provider enums use underscores: "openai_compatible", "minds_cloud".
 *
 *   2. **React state**: camelCase keys, parsed values (booleans, objects).
 *      Sensitive fields masked as "***" when set, empty string when unset.
 *      Provider UI types use hyphens: "openai-compatible", "minds-cloud".
 *
 *   3. **Provider cards** (providers_json): array of {type, apiKey, baseUrl, ...}
 *      objects that drive the Settings UI cards. Backfilled from individual
 *      API key settings on read; synced back on write.
 */

// ─── Key maps ──────────────────────────────────────────────────────────

/** Server snake_case → client camelCase */
export const SETTINGS_KEY_MAP = {
  anthropic_api_key: 'anthropicApiKey',
  openai_api_key: 'openaiApiKey',
  gemini_api_key: 'geminiApiKey',
  openai_compatible_api_key: 'openaiCompatibleApiKey',
  minds_api_key: 'mindsApiKey',
  minds_url: 'mindsUrl',
  planning_provider: 'planningProvider',
  planning_model: 'planningModel',
  planning_reasoning_effort: 'planningReasoningEffort',
  coding_provider: 'codingProvider',
  coding_model: 'codingModel',
  coding_reasoning_effort: 'codingReasoningEffort',
  openai_base_url: 'openaiBaseUrl',
  model_mode: 'modelMode',
  model_overrides: 'modelOverrides',
  providers_json: 'providers',
  provider_status: 'providerStatus',
  provider_status_details: 'providerStatusDetails',
  auto_pin: 'autoPin',
  show_dots: 'showDots',
  show_counters: 'showCounters',
  accent_variant: 'accentVariant',
  memory_enabled: 'memoryEnabled',
  memory_mode: 'memoryMode',
  episodic_memory: 'episodicMemory',
  proactive_dashboards: 'proactiveDashboards',
  act_first: 'actFirst',
  ui_update_mode: 'uiUpdateMode',
  publish_url: 'publishUrl',
  greeting: 'greeting',
  tone: 'tone',
  harness: 'harness',
};

/** Client camelCase → server snake_case */
export const CLIENT_TO_SERVER = Object.fromEntries(
  Object.entries(SETTINGS_KEY_MAP).map(([s, c]) => [c, s]),
);

/** Fields whose server value is a JSON string that the client uses as an object. */
const JSON_FIELDS = new Set(['modelOverrides', 'providers', 'providerStatus', 'providerStatusDetails']);

const PROVIDER_TO_CLIENT = {
  openai_compatible: 'openai-compatible',
  minds_cloud: 'minds-cloud',
};

const PROVIDER_TO_SERVER = {
  'openai-compatible': 'openai_compatible',
  'minds-cloud': 'minds_cloud',
};

const PROVIDER_FIELDS = new Set(['planningProvider', 'codingProvider']);

export function providerValueToType(value) {
  if (!value) return '';
  return PROVIDER_TO_CLIENT[value] || value;
}

export function providerTypeToServerValue(value) {
  if (!value) return '';
  return PROVIDER_TO_SERVER[value] || value;
}

// ─── Static metadata ────────────────────────────────────────────────

// Model names are NOT maintained in this repo. The cowork-server
// (`RECOMMENDED_MODELS` / `RECOMMENDED_PAIR` in app_settings.py) is the
// single source of truth for every provider — it's served by
// `/settings/recommended-models` and overlaid onto `recommendedModels` /
// `recommendedPair` in fetchSettings(). The buckets below are empty
// placeholders so the structure exists before the overlay lands (and so an
// offline shell degrades to free-text model inputs rather than crashing).
export const STATIC_SETTINGS = {
  providerTypes: ['minds-cloud', 'anthropic', 'openai', 'gemini', 'openai-compatible'],
  providerTypeLabels: {
    'minds-cloud': 'MindsHub',
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    gemini: 'Gemini',
    'openai-compatible': 'OpenAI-compatible',
  },
  // Per-provider model id lists (filled at runtime by the backend overlay).
  recommendedModels: {
    'minds-cloud': [], anthropic: [], openai: [], gemini: [], 'openai-compatible': [],
  },
  // Per-provider (planning, coding) default pair (filled at runtime).
  recommendedPair: {
    'minds-cloud': ['', ''], anthropic: ['', ''], openai: ['', ''], gemini: ['', ''], 'openai-compatible': ['', ''],
  },
};

// ─── Model label derivation ─────────────────────────────────────────

const _cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/**
 * Derive a human-readable label from a model id, so the UI never has to
 * maintain a parallel name map alongside the backend's id list. Pure and
 * family-aware (Claude / GPT / Gemini); unknown ids fall through to a
 * best-effort title-cased form. Resilient to new versions — adding
 * `claude-opus-4-9` server-side needs no change here.
 *
 *   claude-opus-4-8            → "Claude Opus 4.8"
 *   claude-haiku-4-5-20251001  → "Claude Haiku 4.5"  (date snapshot dropped)
 *   gpt-5.5-mini               → "GPT-5.5 Mini"
 *   gemini-3-flash-preview     → "Gemini 3 Flash Preview"
 *   o4-mini                    → "o4 Mini"
 */
export function modelLabel(id) {
  if (!id) return '';
  // Drop a trailing date snapshot suffix (e.g. -20251001).
  const s = String(id).replace(/-\d{6,}$/, '');
  if (s.startsWith('claude-')) {
    const [, family, ...ver] = s.split('-');
    const version = ver.join('.');
    return `Claude ${_cap(family)}${version ? ` ${version}` : ''}`;
  }
  if (s.startsWith('gpt-')) {
    const [head, ...rest] = s.slice(4).split('-');
    return `GPT-${head}${rest.map((t) => ` ${_cap(t)}`).join('')}`;
  }
  if (s.startsWith('gemini-')) {
    return `Gemini ${s.slice(7).split('-').map(_cap).join(' ')}`;
  }
  const [head, ...rest] = s.split('-');
  return rest.length ? `${head} ${rest.map(_cap).join(' ')}` : head;
}

/**
 * Map a provider's runtime model-id list to `{id, label}` options for
 * dropdowns. `recommendedModels` is the backend-overlaid map from settings.
 */
export function recommendedModelOptions(recommendedModels, providerType) {
  const ids = (recommendedModels && recommendedModels[providerType]) || [];
  return ids.map((id) => ({ id, label: modelLabel(id) }));
}

// ─── Row → client transform ─────────────────────────────────────────

/**
 * Transform a SettingResponse[] from the server into the flat camelCase
 * settings blob the React UI expects.
 *
 * Handles: key remapping, boolean parsing, JSON parsing, sensitive-field
 * masking, defaultModel derivation, and provider card backfill.
 */
export function transformSettingsRows(rows) {
  const result = { ...STATIC_SETTINGS, providerStatus: {}, providerStatusDetails: {} };

  for (const row of rows) {
    const clientKey = SETTINGS_KEY_MAP[row.key];
    if (!clientKey) continue;
    if (row.is_sensitive) {
      result[clientKey] = row.is_set ? '***' : '';
    } else if (row.value != null) {
      if (row.value === 'True' || row.value === 'true') result[clientKey] = true;
      else if (row.value === 'False' || row.value === 'false') result[clientKey] = false;
      else if (JSON_FIELDS.has(clientKey)) {
        try { result[clientKey] = JSON.parse(row.value); } catch { result[clientKey] = row.value; }
      } else if (PROVIDER_FIELDS.has(clientKey)) {
        result[clientKey] = providerValueToType(row.value);
      } else {
        result[clientKey] = row.value;
      }
    }
  }

  result.defaultModel = result.planningModel || result.defaultModel;
  result.providers = backfillProviders(result);
  return result;
}

// ─── Provider card backfill ──────────────────────────────────────────

/**
 * Ensure the providers array reflects all configured API keys.
 *
 * The stored providers_json may be incomplete (e.g. migrated from
 * state.json with only some providers, or the user configured a key
 * via the Credentials section rather than a provider card).  This
 * backfills missing entries and masks API keys for display.
 */
function backfillProviders(result) {
  const providers = Array.isArray(result.providers)
    ? result.providers.map((p) => ({ ...p, type: providerValueToType(p.type) }))
    : [];
  const hasType = (t) => providers.some((p) => p.type === t);
  const rawPlanningType = providerValueToType(result.planningProvider);
  const rawCodingType = providerValueToType(result.codingProvider);

  // When providers are set to openai-compatible but a MindsHub API key
  // exists, the real provider is minds-cloud (the gateway is OpenAI-
  // compatible under the hood). Promote so the UI shows a MindsHub card
  // instead of a phantom empty OpenAI-compatible row.
  const isMindsBacked = result.mindsApiKey === '***';
  const planningType = (rawPlanningType === 'openai-compatible' && isMindsBacked) ? 'minds-cloud' : rawPlanningType;
  const codingType = (rawCodingType === 'openai-compatible' && isMindsBacked) ? 'minds-cloud' : rawCodingType;

  const activeTypes = [planningType, codingType].filter(Boolean);

  for (const type of activeTypes) {
    if (!hasType(type) && STATIC_SETTINGS.providerTypes.includes(type)) {
      providers.push({ type, apiKey: '', isDefault: type === planningType });
    }
  }

  if (result.anthropicApiKey === '***' && !hasType('anthropic')) {
    providers.push({ type: 'anthropic', apiKey: '***', isDefault: planningType === 'anthropic' });
  }
  if (result.mindsApiKey === '***' && !hasType('minds-cloud')) {
    providers.push({
      type: 'minds-cloud', apiKey: '***',
      mindsUrl: (result.mindsUrl || 'https://api.mindshub.ai/v1').replace(/\/v1$/, ''),
      isDefault: planningType === 'minds-cloud',
    });
  }
  // Skip OpenAI backfill when the active provider is minds-cloud — the
  // stored openai_api_key may just be the Minds key copied during legacy
  // onboarding, and showing a phantom OpenAI card for it is confusing.
  if (result.openaiApiKey === '***' && !hasType('openai') && !isMindsBacked) {
    providers.push({ type: 'openai', apiKey: '***', isDefault: planningType === 'openai' });
  }

  // Stamp the masked sentinel on existing entries that have a stored key.
  // gemini / openai-compatible read their own slot, falling back to the shared
  // openai slot for display (mirrors the server-side provider_api_key fallback)
  // so a user on the legacy shared key still shows as configured.
  for (const p of providers) {
    if (p.type === 'anthropic' && result.anthropicApiKey === '***') p.apiKey = '***';
    if (p.type === 'openai' && result.openaiApiKey === '***') p.apiKey = '***';
    if (p.type === 'gemini' && (result.geminiApiKey === '***' || result.openaiApiKey === '***')) p.apiKey = '***';
    if (p.type === 'openai-compatible' && (result.openaiCompatibleApiKey === '***' || result.openaiApiKey === '***')) p.apiKey = '***';
    if (p.type === 'minds-cloud' && result.mindsApiKey === '***') p.apiKey = '***';
  }
  if (providers.length > 0 && !providers.some((p) => p.isDefault)) {
    providers[0].isDefault = true;
  }
  return providers;
}

// ─── Write diff ──────────────────────────────────────────────────────

/**
 * Diff the current settings against the last-fetched snapshot and return
 * only the server-key → value pairs that actually changed.
 *
 * Skips: masked sentinels ("***"), unchanged values, and keys that don't
 * map to a server setting.  JSON-encodes object values.
 */
/** Keys that are read from the server but never written back — they are
 *  transient UI-only state (e.g. provider test results). */
const WRITE_SKIP = new Set(['providerStatus', 'providerStatusDetails']);

export function diffSettingsForWrite(patch, lastFetched) {
  const writes = {};
  for (const [clientKey, value] of Object.entries(patch)) {
    if (WRITE_SKIP.has(clientKey)) continue;
    const serverKey = CLIENT_TO_SERVER[clientKey];
    if (!serverKey) continue;
    if (value === '***') continue;
    const prev = lastFetched[clientKey];
    if (prev === value) continue;
    if (typeof value === 'object' && JSON.stringify(prev) === JSON.stringify(value)) continue;
    if (JSON_FIELDS.has(clientKey) && typeof value === 'object') {
      writes[serverKey] = JSON.stringify(value);
    } else if (PROVIDER_FIELDS.has(clientKey)) {
      writes[serverKey] = providerTypeToServerValue(value);
    } else {
      writes[serverKey] = String(value);
    }
  }
  return writes;
}

// ─── Provider card ↔ individual key mapping ──────────────────────────

/**
 * Map a provider card type to the individual API key setting it should
 * sync to.  Returns null for unknown types.
 */
export function providerTypeToKeyField(type) {
  if (type === 'anthropic') return 'anthropicApiKey';
  if (type === 'minds-cloud') return 'mindsApiKey';
  if (type === 'openai') return 'openaiApiKey';
  if (type === 'gemini') return 'geminiApiKey';
  if (type === 'openai-compatible') return 'openaiCompatibleApiKey';
  return null;
}
