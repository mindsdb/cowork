// Backend provider identifies the serving vendor and chooses the picker section.
// Infer the model's maker from alias/label for its icon; a host such as Fireworks can serve several
// makers.

// Declaration order = group display order in the picker (mirrors the
// design: MindsHub first, then the frontier labs, Other last).
const MAKERS = [
  { key: 'mindshub', name: 'MindsHub', test: /\bmindshub\b|\bminds hub\b/ },
  { key: 'openai', name: 'OpenAI', test: /\bgpt\b|\bcodex\b|\bchatgpt\b|\bopenai\b|\bo\d\b/ },
  { key: 'anthropic', name: 'Anthropic', test: /\bclaude\b|\bopus\b|\bsonnet\b|\bhaiku\b|\bfable\b/ },
  { key: 'google', name: 'Google', test: /\bgemini\b|\bgemma\b/ },
  { key: 'xai', name: 'xAI', test: /\bgrok\b/ },
  { key: 'moonshot', name: 'Moonshot', test: /\bkimi\b/ },
  { key: 'alibaba', name: 'Alibaba', test: /\bqwen\d?\b|\bqwq\b/ },
  { key: 'deepseek', name: 'DeepSeek', test: /\bdeepseek\b/ },
  { key: 'zai', name: 'Z.ai', test: /\bglm\b/ },
  { key: 'mistral', name: 'Mistral', test: /\bmistral\b|\bcodestral\b|\bdevstral\b|\bmagistral\b|\bpixtral\b/ },
  // Muse Spark is a Meta model; provider grouping alone does not identify its icon.
  { key: 'meta', name: 'Meta', test: /\bllama\b|\bmuse\b/ },
];

export const OTHER_MAKER = { key: 'other', name: 'Other' };

// Client-only sentinel: api.js translates this to model:null so cowork-server uses account
// settings.
export const MODEL_ROUTER_ID = 'model-router';
export const MODEL_ROUTER_LABEL = 'Model Router';
export const MODEL_ROUTER = {
  id: MODEL_ROUTER_ID,
  name: MODEL_ROUTER_LABEL,
  desc: "Routes to this account's configured model automatically",
};

// Section declaration order controls picker order.
// Maker alone does not prove open weights: xAI and Meta fall through to Other because Grok and Muse
// Spark are proprietary.
// If Llama is offered, classify that model separately rather than putting all Meta models in Open
// Weight.
const SECTIONS = [
  { key: 'mindshub', name: 'MindsHub', makers: ['mindshub'] },
  { key: 'anthropic', name: 'Anthropic', makers: ['anthropic'] },
  { key: 'openai', name: 'OpenAI', makers: ['openai'] },
  { key: 'google', name: 'Google', makers: ['google'] },
  {
    key: 'open-weight',
    name: 'Open Weight',
    makers: ['moonshot', 'alibaba', 'deepseek', 'zai', 'mistral'],
  },
];

export const OTHER_SECTION = { key: 'other', name: 'Other' };

export const MINDSHUB_AIR_MODEL_ID = 'mindshub_air';

/**
 * Auth's provider enum cannot identify MindsHub-owned models; match stable public model ids rather
 * than branding text.
 */
export const MINDSHUB_MODEL_IDS = new Set([MINDSHUB_AIR_MODEL_ID]);

/** Every section a lookup can resolve to, Other included. */
const ALL_SECTIONS = [...SECTIONS, OTHER_SECTION];

/** maker key → section, for every maker a section claims. */
const SECTION_BY_MAKER = new Map(
  SECTIONS.flatMap((section) => section.makers.map((maker) => [maker, section])),
);

// Provider-to-section mapping; icons still use maker inference.
// Meta maps to Other because the served model is Muse Spark (see SECTIONS).
const SECTION_BY_PROVIDER = new Map([
  ['anthropic', 'anthropic'],
  ['openai', 'openai'],
  ['gemini', 'google'],
  ['fireworks', 'open-weight'],
  ['moonshot', 'open-weight'],
  ['meta', 'other'],
]);

/**
 * MindsHub-owned ids and maker overrides win over their serving vendor.
 * Then prefer backend provider, with maker inference for BYOK/older servers and Other for unknown
 * values.
 */
export function modelSection(option) {
  const maker = option?.maker || modelMaker(option?.value, option?.label).key;
  if (MINDSHUB_MODEL_IDS.has(option?.value)) return SECTION_BY_MAKER.get('mindshub');
  if (maker === 'mindshub') return SECTION_BY_MAKER.get('mindshub');
  // Resolved against ALL_SECTIONS, not SECTIONS: a provider may map to Other
  // deliberately (`meta`), and that has to find a section rather than fall
  // through as if the provider were unrecognised.
  const byProvider = option?.provider && SECTION_BY_PROVIDER.get(option.provider);
  if (byProvider) return ALL_SECTIONS.find((s) => s.key === byProvider) || OTHER_SECTION;
  return SECTION_BY_MAKER.get(maker) || OTHER_SECTION;
}

/** Infer the maker from alias and label; first declared match wins, otherwise OTHER_MAKER. */
export function modelMaker(id, label = '') {
  const haystack = `${id || ''} ${label || ''}`.toLowerCase().replace(/[_\-./]/g, ' ');
  for (const maker of MAKERS) {
    if (maker.test.test(haystack)) return maker;
  }
  return OTHER_MAKER;
}

/**
 * Group flat picker options into sections, ready for the ModelSelect popup.
 *
 * @param {Array<{value: string, label: string, provider?: string, maker?: string}>} options
 *   Flat option list. `provider` is MindsHub's authoritative serving-vendor field
 *   (the ENG-1111 contract) and decides the section; `maker`, explicit or
 *   inferred, stays the *icon* identity, so collapsing several makers into one
 *   section never costs a model its own mark.
 * @returns {Array<{key: string, name: string, items: object[]}>}
 *   Sections in declaration order, Other last; empty sections dropped; option
 *   order preserved within each section — the server's order is meaningful
 *   upstream (the gateway lists the free/baseline model first), so grouping
 *   never re-ranks.
 */
export function groupModelOptions(options) {
  const byKey = new Map();
  for (const opt of options || []) {
    if (!opt) continue;
    const section = modelSection(opt);
    if (!byKey.has(section.key)) byKey.set(section.key, []);
    byKey.get(section.key).push(opt);
  }
  return ALL_SECTIONS
    .filter((s) => byKey.has(s.key))
    .map((s) => ({ key: s.key, name: s.name, items: byKey.get(s.key) }));
}

// families[id]===id identifies a moving alias; a different value identifies a frozen version.
// An absent id is undescribed, not a moving alias: the global map may cover none of a BYOK
// provider's models.

/** Only explicit false means locked. Missing entries keep BYOK and older-gateway models selectable. */
export function isModelLocked(modelEnabled, id) {
  return (modelEnabled || {})[id] === false;
}

/** True when `id` is a moving alias according to `families`. */
export function isMovingAlias(id, families = {}) {
  return !!families && families[id] === id;
}

/** True when `id` is a frozen version of some other alias. */
export function isFrozenAlias(id, families = {}) {
  return !!families && !!families[id] && families[id] !== id;
}

/**
 * Count a frozen version only when its head is listed; otherwise the orphan has no version marker
 * and must not enable others' markers.
 */
export function hasFrozenVersions(ids, families = {}) {
  const list = ids || [];
  return list.some((id) => isFrozenAlias(id, families) && list.includes(families[id]));
}

/**
 * Keep heads in gateway order (the baseline/free model can lead), moving frozen versions beneath
 * them.
 * Do not drop models with malformed family chains/cycles: that desynchronizes the stored selection
 * from rendered options.
 */
export function orderByFamily(ids, families = {}) {
  const list = ids || [];
  const out = [];
  const placed = new Set();
  const take = (id) => {
    if (placed.has(id)) return;
    placed.add(id);
    out.push(id);
  };
  // Every version that froze `head`, then the versions that froze those. The walk
  // is transitive so a chain (`c → b → a`) nests under the alias at the top of it;
  // one level deep left `c` for the sweep below, which appended it in input order
  // under an unrelated sibling.
  const takeVersionsOf = (head) => {
    for (const other of list) {
      if (other === head || placed.has(other) || families[other] !== head) continue;
      take(other);
      takeVersionsOf(other);
    }
  };
  for (const id of list) {
    // A frozen version whose head is also in this list waits for its head.
    if (isFrozenAlias(id, families) && list.includes(families[id])) continue;
    take(id);
    takeVersionsOf(id);
  }
  // What is left is a cycle, plus anything hanging off one: no member of a cycle is
  // a head, so none of them roots a walk. Appended in input order so the output
  // stays a permutation.
  for (const id of list) take(id);
  return out;
}
