/**
 * Translate server snake_case/string settings into camelCase/parsed React state and provider cards.
 * Sensitive fields arrive as {is_sensitive, is_set} and become *** or empty; provider underscores
 * become UI hyphens.
 * Backfill provider cards from individual key settings on read and synchronize them on write.
 */

import { MINDS_API_BASE } from '../../lib/mindsUrls';
import { mindsServesOpenAiCompatible, endpointHost } from '../../../shared/minds-endpoint';
import { isMovingAlias, isFrozenAlias, hasFrozenVersions, isModelLocked, orderByFamily } from './modelCatalog';

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
  coding_agent_engine: 'codingAgentEngine',
  coding_agent_model: 'codingAgentModel',
  // Router role — history summarization, on the user's pick. The
  // respond-or-delegate gate ahead of each turn resolves its own model
  // server-side (ENG-1851; `settings.gate`, see routerRoleSubtitle) and only
  // runs on this pick for openai-compatible, which has no default to fall to.
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
  show_coding_mode_toggle: 'showCodingModeToggle',
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
  coding_mode_enabled: 'codingModeEnabled',
  harness_hermes_enabled: 'harnessHermesEnabled',
  harness_claude_code_enabled: 'harnessClaudeCodeEnabled',
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

// Use canonical planning_model/coding_model and provider fields: these are what cowork-server
// executes.
// Never use model_overrides for the current selection; the server no longer reads it, hiding real
// stored pins from the picker.
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

// cowork-server owns recommended model lists/pairs through /settings/recommended-models.
// Keep local buckets empty until overlay; offline shells can fall back to custom input.
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
 * Fallback naming from model ids, including family/version formatting.
 * Render paths must call displayModelLabel first so policy-supplied names take precedence.
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
    const family = /^\d/.test(head) ? `GPT-${head}` : `GPT ${_cap(head)}`;
    return `${family}${rest.map((t) => ` ${_cap(t)}`).join('')}`;
  }
  if (s.startsWith('gemini-')) {
    return `Gemini ${s.slice(7).split('-').map(_cap).join(' ')}`;
  }
  const [head, ...rest] = s.split('-');
  return rest.length ? `${head} ${rest.map(_cap).join(' ')}` : head;
}

/** Prefer policy labels, falling back to id-derived names for BYOK and missing catalog entries. */
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

/** `live` in the order of `current`, with ids new to `live` appended. */
function keepListOrder(current, live) {
  const held = (current || []).filter((id) => live.includes(id));
  return [...held, ...live.filter((id) => !held.includes(id))];
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
export function mergeRecommendedModels(prev, rec, { keepOrder = false } = {}) {
  if (!rec || typeof rec !== 'object') return null;
  const base = prev || {};
  const overlayLists = (current, live, reorder) => {
    const merged = { ...current };
    for (const [k, v] of Object.entries(live || {})) {
      if (Array.isArray(v) && v.length) merged[k] = reorder ? reorder(current?.[k], v) : v;
    }
    return merged;
  };
  const overlayMap = (current, live) => (
    live && typeof live === 'object' && Object.keys(live).length ? live : (current || {})
  );
  return {
    // On-open refresh preserves existing row positions to avoid moving targets under the cursor;
    // append new ids and drop removed ones.
    // Mount-time loads take gateway order.
    recommendedModels: overlayLists(base.recommendedModels, rec.recommendedModels, keepOrder ? keepListOrder : null),
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
    // Which model the server's per-turn route gate runs on (ENG-1851). Sent by
    // servers that resolve it apart from the router pick; an older server sends
    // nothing and the row falls back to describing what that server does.
    gate: (rec.gate && typeof rec.gate === 'object') ? rec.gate : (base.gate ?? null),
  };
}

// ─── Role row copy ──────────────────────────────────────────────────

/**
 * Display the server-reported gate model rather than reconstructing its routing rule across OTA
 * versions.
 * Legacy servers omit gate when gating follows the router pick.
 */
export function routerRoleSubtitle(gate, { rowProviderType = '', providerTypeLabels = {} } = {}) {
  if (!gate || typeof gate !== 'object') {
    return 'Used for fast respond-or-delegate gating on each turn, and history summarization.';
  }
  if (!gate.model) {
    return gate.followsRouterPick
      ? 'Used for history summarization. The respond-or-delegate gate ahead of each chat turn is off until a model is picked here.'
      : 'Used for history summarization. The respond-or-delegate gate ahead of each chat turn is off: no model is available for it.';
  }
  if (gate.followsRouterPick) {
    return 'Used for history summarization and for the respond-or-delegate gate ahead of each chat turn, '
      + 'which has a strict latency budget: pick your fastest model here, not your smartest.';
  }
  // Name the provider only when it is not the one this row shows — the server
  // may have resolved the role elsewhere (a stored provider with no key).
  const where = gate.provider && gate.provider !== rowProviderType
    ? ` (${providerTypeLabels[gate.provider] || gate.provider})`
    : '';
  return `Used for history summarization. The respond-or-delegate gate ahead of each chat turn runs on ${gate.model}${where}, not on this pick.`;
}

// ─── Model picker select-value resolution ───────────────────────────

/**
 * Resolve which model id a role's picker should treat as "current," given a
 * provider that may have changed out from under a model saved for a
 * DIFFERENT provider. Pure so this substitution is unit-tested directly
 * (SettingsView.jsx's RoleRow inlines the JSX around it).
 *
 * `providerWasRepointed` (the role's stored provider itself didn't match any
 * configured provider card, e.g. it named a provider the user disconnected)
 * already substitutes the fallback. This covers the other, easy-to-miss way
 * a stored model goes stale: the PROVIDER field is already correct (e.g. an
 * SSO sign-in wrote `planning_provider: minds_cloud` server-side) but the
 * paired model field wasn't touched, so it still names a model from
 * whatever provider was configured before — an Anthropic id sitting under a
 * now-minds-cloud provider. minds-cloud has no free-text mode, so that
 * surfaces as `resolveModelPickerValue`'s "legacy — re-select a model"
 * stale-pin placeholder instead of just picking a valid model. Defaulting
 * to `fallbackModel` here is the same substitution an explicit provider
 * switch already gets via `setRoleDriver`.
 *
 * A BYOK provider (`allowOther: true`) is exempt: an unlisted id there is a
 * legitimate user-typed custom model, not staleness.
 *
 * @param {boolean} providerWasRepointed the role's provider field was itself stale
 * @param {string} storedModel the role's persisted model id ('' when unset)
 * @param {string[]} modelList the CURRENT provider's recommended model ids
 * @param {boolean} allowOther whether the current provider accepts a free-text id
 * @param {string} fallbackModel the current provider's recommended default for this role
 */
export function resolveRoleModel(providerWasRepointed, storedModel, modelList, allowOther, fallbackModel) {
  const list = Array.isArray(modelList) ? modelList : [];
  const modelStaleForProvider = !!storedModel && !allowOther && !list.includes(storedModel);
  return (providerWasRepointed || modelStaleForProvider) ? fallbackModel : storedModel;
}

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
  // Gate custom mode on allowOther even when forceCustom survives a provider switch; otherwise no
  // rendered option matches the value.
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
 *   (settings.modelEnabled); a model mapped to `false` renders disabled, tagged
 *   "Needs credits", and flagged `locked` so the picker puts an "Add credits"
 *   button on the row.
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
  const isLocked = (m) => isModelLocked(modelEnabled, m);
  const labelFor = (m) => displayModelLabel(m, modelLabels);

  const { modelProviders = {}, modelFamilies = {} } = meta || {};
  // Use shared family rules; missing entries mean undescribed BYOK models, not moving aliases.
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

  // Keep version/credit markers in tag: label also feeds the closed trigger and search.
  // Join markers so wallet state cannot hide version state; family classification is shared with
  // the composer.
  const tagFor = (m) => [
    tagMoving && isMoving(m) ? 'Latest' : '',
    isPinnedUnderHead(m) ? 'Older version' : '',
    isLocked(m) ? 'Needs credits' : '',
  ].filter(Boolean).join(' · ');

  const modelOption = (m) => {
    const tag = tagFor(m);
    const locked = isLocked(m);
    return {
      value: m,
      label: labelFor(m),
      /*
       * Disable locked models to avoid silently executing a different affordable fallback.
       * Keep stored pins rendered, even when locked, and set locked so ModelSelect offers Add
       * credits.
       */
      disabled: locked,
      ...(locked ? { locked: true } : {}),
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
    ...ordered.map(modelOption),
    ...(allowOther ? [{ value: '__custom__', label: 'Other…', pin: 'bottom' }] : []),
  ];
}

// ─── Row → client transform ─────────────────────────────────────────

export function transformSettingsRows(rows) {
  const result = { ...STATIC_SETTINGS, providerStatus: {}, providerStatusDetails: {} };

  for (const row of rows) {
    const clientKey = SETTINGS_KEY_MAP[row.key];
    if (!clientKey) continue;
    // Harness options come from installed server harnesses; distinguish an unselected harness from
    // one unavailable to this server.
    if (row.key === 'harness' && Array.isArray(row.options)) {
      result.harnessOptions = row.options;
    }
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
 * Backfill provider cards from individual key settings; migrated or independently configured keys
 * may be absent from providers_json.
 */
function backfillProviders(result) {
  const providers = Array.isArray(result.providers)
    ? result.providers.map((p) => ({ ...p, type: providerValueToType(p.type) }))
    : [];
  const hasType = (t) => providers.some((p) => p.type === t);
  const rawPlanningType = providerValueToType(result.planningProvider);
  const rawCodingType = providerValueToType(result.codingProvider);

  // A MindsHub key alone does not identify an OpenAI-compatible endpoint; the user may have
  // switched to a local model.
  // Use the base URL to promote the card. Omit the OpenAI key for this display decision so an
  // absent endpoint stays on MindsHub.
  const isMindsBacked = result.mindsApiKey === '***'
    && mindsServesOpenAiCompatible({
      baseUrl: result.openaiBaseUrl,
      mindsUrl: result.mindsUrl,
    });
  const planningType = (rawPlanningType === 'openai-compatible' && isMindsBacked) ? 'minds-cloud' : rawPlanningType;
  const codingType = (rawCodingType === 'openai-compatible' && isMindsBacked) ? 'minds-cloud' : rawCodingType;

  const activeTypes = [planningType, codingType].filter(Boolean);

  for (const type of activeTypes) {
    if (!hasType(type) && STATIC_SETTINGS.providerTypes.includes(type)) {
      const card = { type, apiKey: '', isDefault: type === planningType };
      // A base URL is this provider's credential, so a card reconstructed
      // without it reads as unconfigured — which is what repoints a role away
      // from a working local endpoint whose card was never persisted.
      if (type === 'openai-compatible' && result.openaiBaseUrl) {
        card.baseUrl = result.openaiBaseUrl;
        // A custom provider must carry a name or the Save button stays
        // disabled, so a card the user never created cannot be the reason
        // their settings will not save. The endpoint is the honest label.
        card.name = endpointHost(result.openaiBaseUrl) || 'OpenAI-compatible';
      }
      providers.push(card);
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
 * Return changed server-key/value pairs; skip masked sentinels and unmapped keys, and JSON-encode
 * objects.
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
    // `null` is a tombstone ("clear the stored row"), handled by
    // updateSettings as a DELETE — never a PUT of the string "null".
    if (value === null) continue;
    // Older servers reject absent budget fields, failing the whole save.
    // Keep this check budget-specific: applying it to all keys would discard the first save before
    // settings load.
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

// Preserve string values across save/refetch: dirty-state comparison uses JSON and treats type
// changes as edits.

export const BUDGET_FIELDS = {
  maxToolRounds: { min: 5, max: 500, fallback: 50 },
  maxContinuations: { min: 0, max: 25, fallback: 5 },
  // Keep ranges aligned with cowork-server UserSettings ge/le and test_agent_budget_settings.py or
  // the entire multi-key save can fail.
  // The 750k floor allows several LLM rounds with a ~190k-token context; smaller ceilings can
  // expire before useful work.
  // Store natural token counts; unitDivisor changes only the input’s display to millions.
  maxTurnTokens: { min: 750_000, max: 50_000_000, fallback: 1_250_000, unitDivisor: 1_000_000 },
};

/** Keep incomplete numeric edits (such as a lone minus) unchanged rather than displaying NaN. */
export function toDisplayUnits(v, spec) {
  const unit = spec.unitDivisor || 1;
  if (v == null) return '';
  if (unit === 1 || v === '') return String(v);
  const n = Number(v);
  return Number.isFinite(n) ? String(n / unit) : String(v);
}

/** Inverse of `toDisplayUnits` — what the input holds -> natural units to store. */
export function toNaturalUnits(raw, spec) {
  const unit = spec.unitDivisor || 1;
  if (unit === 1 || raw === '' || raw == null) return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? String(n * unit) : raw;
}

/** Comma-group a number for display — e.g. 50000 -> "50,000". */
export function formatCount(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('en-US') : String(n);
}

/**
 * Use Number, not parseInt, so 5e2 means 500. Empty/unparseable input resets to the spec fallback
 * on blur.
 */
export function clampBudgetValue(raw, spec) {
  const { min, max, fallback } = spec;
  let n = Math.round(Number(raw));
  if (raw == null || String(raw).trim() === '' || Number.isNaN(n)) {
    n = fallback;
  }
  return String(Math.min(max, Math.max(min, n)));
}

/**
 * No limit writes spec.max, not a sentinel; this is a high finite ceiling and can still be reached.
 * Zero cannot mean unlimited because maxContinuations=0 means no continuations.
 */
export function isBudgetUnlimited(value, spec) {
  if (spec?.max == null || value == null || String(value).trim() === '') return false;
  return Number(value) >= spec.max;
}

/**
 * Restore the remembered value, saved value, then default, excluding the unlimited ceiling so the
 * switch can turn off.
 * Clamp restored values to current bounds for compatibility with server validation.
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
 * Clamp valid draft budgets at save time: Escape/unmount can bypass blur validation.
 * Leave absent keys absent for older servers. Drop empty/unparseable drafts rather than resetting
 * saved values; the post-save fetch restores them.
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
