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
import { isMovingAlias, isFrozenAlias, hasFrozenVersions, orderByFamily } from './modelCatalog';

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
  max_tool_rounds: 'maxToolRounds',
  max_continuations: 'maxContinuations',
  max_turn_tokens: 'maxTurnTokens',
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
    // Picker grouping metadata, same rule: an empty map from the server (older
    // cowork-server, BYOK provider, failed fetch) must not wipe what we hold.
    // Losing these degrades the picker to inferred sections and no "latest"
    // tags rather than breaking it.
    modelProviders: overlayMap(base.modelProviders, rec.modelProviders),
    modelFamilies: overlayMap(base.modelFamilies, rec.modelFamilies),
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
 *   (settings.modelEnabled); a model mapped to `false` renders selectable
 *   with a "Needs credits" tag (ENG-1248).
 * @param {Record<string, string>} modelLabels per-model display label
 *   (settings.modelLabels, MindsHub-supplied). Display-only — the id/alias
 *   passed as `value` is still what's saved/resolved everywhere else. A
 *   model missing here (every direct provider; a minds-cloud model with no
 *   label) falls back to modelLabel()'s id-derived label.
 */
export function buildModelOptions(
  curModel,
  modelList,
  allowOther,
  showStalePin,
  modelEnabled = {},
  modelLabels = {},
  meta = {},
) {
  const list = Array.isArray(modelList) ? modelList : [];
  const isLocked = (m) => modelEnabled[m] === false;
  const labelFor = (m) => displayModelLabel(m, modelLabels);

  const { modelProviders = {}, modelFamilies = {} } = meta || {};
  // Family rules come from lib/modelCatalog so this picker and the composer cannot
  // disagree about them. Presence in `modelFamilies` is the signal, NOT the map
  // being non-empty: the map is global to the settings blob while `modelList` is
  // per-provider, so for a BYOK role every id is absent from it. Reading absent as
  // "is its own head" tagged every BYOK model "(latest)", including dated
  // snapshots that provably never move.
  const isMoving = (m) => isMovingAlias(m, modelFamilies);
  // A frozen version whose head is also listed. An orphan — a typo'd `family`, or a
  // head filtered out upstream — is listed but carries no tag at all: "older
  // version" is a claim relative to a newer one, and with no head present there is
  // nothing for the user to read it against.
  const isPinnedUnderHead = (m) => isFrozenAlias(m, modelFamilies) && list.includes(modelFamilies[m]);

  // The moving-alias marker only earns its place once something in this list is NOT
  // the latest. On a catalog of all-moving aliases it would sit on every row, which
  // distinguishes nothing.
  const tagMoving = hasFrozenVersions(list, modelFamilies);

  // Display-only ordering: a frozen version is listed directly under the alias it
  // froze. Total by construction — see orderByFamily; a dropped id would give
  // `showStalePin === false` with no rendered option, the ENG-739 desync class.
  const ordered = orderByFamily(list, modelFamilies);

  // Version state rides on `tag`, the row's right-aligned pill (see ui/Combobox),
  // never in `label`: ModelSelect renders the selected option's label verbatim in a
  // fixed-width trigger and filters on that same string, so a marker in the label
  // showed permanently in the closed control and made typing "latest" or "version"
  // match rows by their marker instead of by their name.
  //
  // A row has one pill slot, so markers JOIN into it in the order below rather than
  // one displacing another: an alias either moves or is frozen, and whatever else
  // ends up in the slot (the wallet's "Needs credits" state) reads after the version
  // state, so no marker can hide another.
  //
  // Both pickers read the same family rules from lib/modelCatalog, so they always
  // agree on which alias moves. They render that differently on purpose: this one
  // words both states in the pill, while the composer's menu shows a "latest" pill
  // and marks a frozen version by indenting it under its head instead.
  const tagFor = (m) => [
    tagMoving && isMoving(m) ? 'Latest' : '',
    isPinnedUnderHead(m) ? 'Older version' : '',
    isLocked(m) ? 'Needs credits' : '',
  ].filter(Boolean).join(' · ');

  const modelOption = (m) => {
    const tag = tagFor(m);
    return {
      value: m,
      label: labelFor(m),
      // A model the wallet can't currently pay for stays selectable: the wall
      // moves to use time, where the top-up card offers a way out. A disabled
      // row was a dead end, and the call site derives its own top-up hint from
      // the same modelEnabled map.
      disabled: false,
      ...(tag ? { tag } : {}),
      // MindsHub's authoritative serving-vendor field, which decides the picker
      // section. Absent for every BYOK provider, where it falls back to inference.
      ...(modelProviders[m] ? { provider: modelProviders[m] } : {}),
    };
  };

  return [
    ...(showStalePin
      // Labeled "legacy — re-select" (not "current") so it reads as an
      // action to take, not a selection: the same model may also appear
      // below as a real selectable row, and a bare "(current)" would look
      // like two identical, already-selected entries (ENG-739 review).
      ? [{
          value: '__stale__',
          label: `${labelFor(curModel.replace(/^latest:/, ''))} (legacy — re-select a model)`,
          disabled: true,
          // `pin` keeps the special entries out of ModelSelect's provider
          // groups: 'top'/'bottom' render unheaded above/below the groups.
          pin: 'top',
        }]
      : []),
    // Wallet-based access (ENG-412, #434), pay-as-you-go shape (ENG-1248): a
    // model the org's wallet can't currently pay for stays selectable, and the
    // "Needs credits" state rides in the same pill as the version state rather
    // than in the label. A disabled row was a dead end (click did nothing, no
    // route to credits), and the label suffix ate the width (truncated
    // "…Add credits to unl.").
    ...ordered.map(modelOption),
    ...(allowOther ? [{ value: '__custom__', label: 'Other…', pin: 'bottom' }] : []),
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
    // Budget keys are writable only when the server serves them: the server
    // returns a row for every settings field, so absence from the fetched
    // snapshot means an older server that would 400 the write (and fail the
    // whole multi-key save with it). Deliberately budget-scoped: lastFetched
    // is {} until the first successful fetch, so as a global rule this would
    // silently drop the first save of a session. For budget keys the trade
    // is worth it — absence really does mean a server that can't take them.
    if (clientKey in BUDGET_FIELDS && !(clientKey in lastFetched)) continue;
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

// ─── Agent budget clamping ───────────────────────────────────────────
//
// The server bounds these (pydantic ge/le) and 400s anything outside, and a
// failed key fails the whole multi-key save — so the client must never PUT
// an out-of-range value. Values are STRINGS end-to-end (server rows are
// strings; the page-wide dirty compare is a JSON diff, so types must survive
// the save → re-fetch round trip unchanged).

export const BUDGET_FIELDS = {
  maxToolRounds: { min: 5, max: 500, fallback: 50 },
  maxContinuations: { min: 0, max: 25, fallback: 5 },
  // Per-turn spend ceiling (ENG-1286). `min` is 750_000, not 0 and not a
  // rounder-looking 100_000: a turn's first LLM call costs roughly the
  // conversation's context (~190k on a long one), so a ceiling below a couple
  // of calls stops the turn before it has done anything. Measured against
  // anton, a 100_000 ceiling dispatched ZERO tools and still spent 400_000 —
  // and this input CLAMPS INTO that band, so a user typing 0 (the natural way
  // to say "no limit") landed on the single worst value available. 750_000 is
  // the lowest value where a 190k-context turn still gets several rounds, and
  // it sits just above the p75 external turn (736k).
  // Ranges must stay in lockstep with UserSettings' ge/le — a value this clamp
  // allows but the server rejects 400s the whole multi-key save, not just this
  // field. cowork-server pins the mirror in test_agent_budget_settings.py.
  maxTurnTokens: { min: 750_000, max: 50_000_000, fallback: 1_250_000 },
};

/**
 * Clamp one budget value into its range, as a string.
 *
 * Number() (not parseInt) so number-input-legal forms like "5e2" mean 500,
 * not 5. Unparseable/empty input falls back to `prev` (the last committed
 * value — clearing a field to retype must not silently reset a saved 500 to
 * the factory default) and only then to the spec fallback.
 */
export function clampBudgetValue(raw, spec, prev = null) {
  const { min, max, fallback } = spec;
  let n = Math.round(Number(raw));
  if (raw == null || String(raw).trim() === '' || Number.isNaN(n)) {
    const p = Math.round(Number(prev));
    n = (prev != null && String(prev).trim() !== '' && !Number.isNaN(p)) ? p : fallback;
  }
  return String(Math.min(max, Math.max(min, n)));
}

/**
 * Is this budget effectively unlimited — i.e. pinned to the top of its range?
 *
 * "No limit" writes `spec.max` rather than a sentinel, so the top of the range
 * IS the off switch — it was only ever a problem because it was undiscoverable,
 * which the checkbox fixes.
 *
 * EFFECTIVELY off, not literally: a turn makes roughly
 * `maxToolRounds x (maxContinuations + 1)` LLM calls, so at the server's
 * defaults (50 x 6 = ~306) 50M is reached at ~163k per call — below the ~190k a
 * long conversation carries. It has never happened (largest turn in 30 days of
 * production: 8.26M), but the step cap is not a guarantee that it can't.
 *
 * A 0-means-unlimited sentinel was
 * built and removed: it needed a hole in the range, a server-side validator to
 * guard the hole, and a special case in this clamp, and it collided with
 * `maxContinuations`, where 0 means literally zero.
 */
export function isBudgetUnlimited(value, spec) {
  if (spec?.max == null || value == null || String(value).trim() === '') return false;
  return Number(value) >= spec.max;
}

/**
 * The number to put back when "no limit" is switched OFF.
 *
 * Lives here rather than in the component because it is the one real decision
 * in the toggle, and `SettingsView` has no test coverage. Order: the value the
 * user had before they ticked the box, then the last committed value, then the
 * factory default — never the sentinel itself, which would leave the switch
 * stuck on. Candidates are clamped, so a remembered value that predates a floor
 * change comes back legal rather than 400ing the save.
 */
export function resolveBudgetRestore(remembered, saved, spec) {
  for (const candidate of [remembered, saved]) {
    if (candidate == null) continue;
    if (String(candidate).trim() === '') continue;
    if (isBudgetUnlimited(candidate, spec)) continue;
    return clampBudgetValue(candidate, spec);
  }
  return String(spec.fallback);
}

/**
 * Return `settings` with any present budget keys clamped into range, and
 * empty/unparseable drafts DROPPED from the write entirely.
 *
 * Safety net for values that skipped the input's blur clamp (e.g. the
 * settings modal dismissed with Escape mid-edit — React fires no blur on
 * unmount, and the raw draft survives in App state). Two rules:
 *   * Keys the server never sent stay absent: materializing them here would
 *     create a phantom write — and a failing one on an older server. (Also
 *     enforced structurally: the Settings UI only renders the budget section
 *     when the fetched snapshot has the keys, and diffSettingsForWrite skips
 *     budget keys absent from it.)
 *   * An empty or unparseable draft is "no instruction", not "reset to
 *     default": clamping '' to the factory fallback here would silently
 *     overwrite the user's saved value (this function has no access to it).
 *     Dropping the key means diffSettingsForWrite writes nothing and the
 *     server keeps what it has; the post-save re-fetch heals the input.
 */
export function clampBudgets(settings) {
  let out = settings;
  for (const [key, spec] of Object.entries(BUDGET_FIELDS)) {
    const v = settings?.[key];
    if (v == null) continue;
    if (String(v).trim() === '' || Number.isNaN(Math.round(Number(v)))) {
      const { [key]: _dropped, ...rest } = out;
      out = rest;
      continue;
    }
    const clamped = clampBudgetValue(v, spec);
    if (clamped !== String(v)) out = { ...out, [key]: clamped };
  }
  return out;
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
