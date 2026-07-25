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

import { MINDS_API_BASE } from '../../lib/mindsUrls';

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
  // Router (anton's "thalamus" role) — the cheap front-model that gates each
  // turn respond-vs-delegate AND runs history summarization. Selectable so
  // users can point routing+summarization at a cheap model (defaults per
  // provider: MindsHub→kimi, else smallest).
  router_provider: 'routerProvider',
  router_model: 'routerModel',
  openai_base_url: 'openaiBaseUrl',
  model_mode: 'modelMode',
  model_overrides: 'modelOverrides',
  providers_json: 'providers',
  provider_status: 'providerStatus',
  provider_status_details: 'providerStatusDetails',
  auto_pin: 'autoPin',
  show_dots: 'showDots',
  show_counters: 'showCounters',
  nav_title: 'navTitle',
  nav_title_color: 'navTitleColor',
  nav_logo: 'navLogo',
  show_theme_toggle: 'showThemeToggle',
  show_8bit_toggle: 'show8bitToggle',
  accent_variant: 'accentVariant',
  memory_enabled: 'memoryEnabled',
  memory_mode: 'memoryMode',
  episodic_memory: 'episodicMemory',
  proactive_dashboards: 'proactiveDashboards',
  act_first: 'actFirst',
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

const PROVIDER_FIELDS = new Set(['planningProvider', 'codingProvider', 'routerProvider']);

export function providerValueToType(value) {
  if (!value) return '';
  return PROVIDER_TO_CLIENT[value] || value;
}

export function providerTypeToServerValue(value) {
  if (!value) return '';
  return PROVIDER_TO_SERVER[value] || value;
}

// ─── Effective (server-executed) role config ────────────────────────
//
// ENG-739: the model/provider a role ACTUALLY runs on comes from the
// canonical planning_model / coding_model (+ *_provider) settings — the flat
// fields cowork-server resolves from at turn time. `model_overrides` is
// orphaned renderer state the server stopped reading (resolution moved off the
// nested blob and its reader, cowork/runtime/inference.py, was removed). The
// picker used to source its "current model" from `model_overrides`, so a stale
// planning_model pin — e.g. a login-written `latest:sonnet` — was invisible in
// the picker: it showed the override's model as already-selected, offered no
// change to save, and a stuck free-tier user had no self-serve recovery. These
// helpers read the executed field so the pin surfaces (via the stale
// placeholder in resolveModelPickerValue) and picking an enabled model is a
// real, savable change — matching what a direct PUT /settings/planning_model
// does. Never consult `model_overrides` for the current value.
export function effectiveRoleModel(settings, role) {
  const s = settings || {};
  if (role === 'planning') return s.planningModel ?? s.defaultModel ?? '';
  if (role === 'router') return s.routerModel ?? '';
  return s.codingModel ?? '';
}

export function effectiveRoleProvider(settings, role) {
  const s = settings || {};
  const raw = role === 'planning' ? s.planningProvider
    : role === 'router' ? s.routerProvider
    : s.codingProvider;
  return providerValueToType(raw) || 'minds-cloud';
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
  // Per-provider default model tuple (filled at runtime by the backend
  // overlay). Historically [planning, coding]; extended to
  // [planning, coding, router]. A missing 3rd slot falls back to the coding
  // default in the UI, so an un-upgraded backend still works.
  recommendedPair: {
    'minds-cloud': ['', '', ''], anthropic: ['', '', ''], openai: ['', '', ''], gemini: ['', '', ''], 'openai-compatible': ['', '', ''],
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
 * The display name for a model id: MindsHub's policy-supplied label when we
 * have one, else the id-derived form above. One rule, used by every picker, so
 * the composer and the Settings dropdown can't disagree about a model's name.
 *
 * `modelLabels` only ever covers minds-cloud (direct providers don't publish
 * labels), so the fallback is the normal case, not an error path.
 */
export function displayModelLabel(id, modelLabels = {}) {
  return (modelLabels && modelLabels[id]) || modelLabel(id);
}

/**
 * Map a provider's runtime model-id list to `{id, label}` options for
 * dropdowns. `recommendedModels` is the backend-overlaid map from settings.
 */
export function recommendedModelOptions(recommendedModels, providerType, modelLabels = {}) {
  const ids = (recommendedModels && recommendedModels[providerType]) || [];
  return ids.map((id) => ({ id, label: displayModelLabel(id, modelLabels) }));
}

/**
 * Merge a `/settings/recommended-models` response into the settings we already
 * hold, returning just the keys it owns. Used by both the mount-time load and
 * the picker's on-open refresh so there is one rule for this, not two.
 *
 * Nothing empty from the server ever overwrites something we have:
 *
 *   - a per-provider list is replaced only when the live one is non-empty. An
 *     unconfigured provider comes back `[]` (`RECOMMENDED_MODELS['minds-cloud']`
 *     is an empty placeholder server-side), and so does a *failed* MindsHub
 *     fetch — the endpoint still answers 200. Overwriting on that empties the
 *     picker until the app restarts.
 *   - the id-keyed maps are replaced only when the live one is non-empty, for
 *     the same reason. An empty `modelEnabled` reads as "everything is
 *     available" and would silently unlock paid models; cowork-server refuses
 *     to persist an empty map for exactly this reason.
 *
 * The cost of that is a stale entry outliving a model's removal from the
 * policy, which self-corrects on the next successful fetch. Losing the list
 * does not self-correct, so this is the right way round.
 *
 * @param {object} prev current settings (or the freshly transformed rows)
 * @param {object|null} rec the endpoint's response, or null when it failed
 * @returns {object|null} the subset of settings keys to apply, null if nothing
 *   is usable (caller leaves what it has alone)
 */
export function mergeRecommendedModels(prev, rec) {
  if (!rec || typeof rec !== 'object') return null;
  const base = prev || {};
  const overlayLists = (current, live) => {
    const merged = { ...current };
    for (const [k, v] of Object.entries(live || {})) {
      if (Array.isArray(v) && v.length) merged[k] = v;
    }
    return merged;
  };
  const overlayMap = (current, live) => (
    live && typeof live === 'object' && Object.keys(live).length ? live : (current || {})
  );
  return {
    recommendedModels: overlayLists(base.recommendedModels, rec.recommendedModels),
    recommendedPair: overlayLists(base.recommendedPair, rec.recommendedPair),
    modelEfforts: overlayMap(base.modelEfforts, rec.modelEfforts),
    modelEnabled: overlayMap(base.modelEnabled, rec.modelEnabled),
    modelLabels: overlayMap(base.modelLabels, rec.modelLabels),
  };
}

// ─── Model picker select-value resolution ───────────────────────────

/**
 * Resolve the controlled <select> value + mode for the Agent-Models model
 * picker, given the currently-stored model and the provider's recommended
 * list. Pure so the desync rule is unit-tested directly (SettingsView.jsx
 * inlines the JSX around this).
 *
 * The invariant this enforces: the returned `selectValue` must always match a
 * rendered <option>, or selection silently breaks. A stored value that isn't
 * in `modelList` splits two ways:
 *
 *   - `allowOther` provider (anthropic/openai/…): it's a user-typed custom id →
 *     free-text mode (`__custom__`, with a text input).
 *   - minds-cloud (no free text): it's a stale pin, e.g. the login-written
 *     `latest:sonnet` → show it as a disabled placeholder (`__stale__`) so
 *     re-picking a listed model is a real change event that writes the model.
 *     Routing it through `__custom__` (never rendered for minds-cloud) is the
 *     ENG-739 bug: value matches no option → "Saved" changes nothing.
 *
 * @param {string} curModel   currently-stored model id ('' when unset)
 * @param {string[]} modelList provider's recommended model ids
 * @param {boolean} allowOther whether the provider accepts a free-text id
 * @param {boolean} forceCustom user has explicitly toggled "Other…" mode
 */
export function resolveModelPickerValue(curModel, modelList, allowOther, forceCustom = false) {
  const list = Array.isArray(modelList) ? modelList : [];
  const savedNotListed = !!curModel && !list.includes(curModel);
  const savedIsCustom = savedNotListed && allowOther;
  const showStalePin = savedNotListed && !allowOther;
  // Free-text mode requires a provider that accepts it. Gating on `allowOther`
  // keeps the invariant "selectValue always matches a rendered option" true
  // even when `forceCustom` lingers from a prior provider: toggling "Other…"
  // on Anthropic then repointing to minds-cloud (which renders neither a
  // `__custom__` option nor a text input) would otherwise wedge the control
  // into a blank, unwritable select — the same "Saved but not applied" bug via
  // a different door.
  const inputMode = (!!forceCustom || savedIsCustom) && allowOther;
  const selectValue = inputMode
    ? '__custom__'
    : (showStalePin ? '__stale__' : curModel);
  return { savedIsCustom, showStalePin, inputMode, selectValue };
}

/**
 * Build the model `<Select>` option list for the Agent-Models picker, given
 * `resolveModelPickerValue`'s `showStalePin` flag. Pairs with it: every
 * value `resolveModelPickerValue` can return (`selectValue`) has a matching
 * entry here, which is what keeps the ENG-739 invariant true end-to-end —
 * a stored pin or a locked model is always a real, rendered (if disabled)
 * option, never a value the control can silently desync on.
 *
 * @param {string} curModel     currently-stored model id
 * @param {string[]} modelList  provider's recommended model ids
 * @param {boolean} allowOther  whether to append the "Other…" custom-id entry
 * @param {boolean} showStalePin from resolveModelPickerValue
 * @param {Record<string, boolean>} modelEnabled per-model availability map
 *   (settings.modelEnabled); a model mapped to `false` renders locked.
 * @param {Record<string, string>} modelLabels per-model display label
 *   (settings.modelLabels, MindsHub-supplied). Display-only — the id/alias
 *   passed as `value` is still what's saved/resolved everywhere else. A
 *   model missing here (every direct provider; a minds-cloud model with no
 *   label) falls back to modelLabel()'s id-derived label.
 */
export function buildModelOptions(curModel, modelList, allowOther, showStalePin, modelEnabled = {}, modelLabels = {}) {
  const list = Array.isArray(modelList) ? modelList : [];
  const isLocked = (m) => modelEnabled[m] === false;
  const labelFor = (m) => displayModelLabel(m, modelLabels);
  return [
    ...(showStalePin
      // Labeled "legacy — re-select" (not "current") so it reads as an
      // action to take, not a selection: the same model may also appear
      // below as a real "— Add credits to unlock" row, and a bare "(current)"
      // would look like two identical, already-selected entries (ENG-739
      // review).
      ? [{
          value: '__stale__',
          label: `${labelFor(curModel.replace(/^latest:/, ''))} (legacy — re-select a model)`,
          disabled: true,
        }]
      : []),
    // Wallet-based access (ENG-412, #434): a locked model is one the org's
    // wallet can't currently pay for — prompt to add credits, not upgrade.
    ...list.map((m) => ({
      value: m,
      label: `${labelFor(m)}${isLocked(m) ? ' — Add credits to unlock' : ''}`,
      disabled: isLocked(m),
    })),
    ...(allowOther ? [{ value: '__custom__', label: 'Other…' }] : []),
  ];
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
      mindsUrl: (result.mindsUrl || `${MINDS_API_BASE}/v1`).replace(/\/v1$/, ''),
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
