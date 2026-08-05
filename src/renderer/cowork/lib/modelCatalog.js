// Model → maker (the company that trains the model) inference + grouping
// for the model picker (ENG-1096).
//
// The backend doesn't tell us who makes a model yet: a `/v1/models` row
// carries id/label/enabled/efforts but no maker field (ENG-1111 asks for
// one). Until that lands, the maker is inferred from the alias + label the
// same way `modelLabel` derives display names — pure, family-aware, and
// resilient to new versions. An alias that matches nothing (`muse-spark`)
// lands in the "Other" bucket rather than a wrong group. When ENG-1111
// ships, options can carry an explicit `maker` key and the guessing here
// stops applying to them.

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
  // `muse` alongside llama: Muse Spark is Meta's, and matching it here is what
  // gets it Meta's mark instead of the neutral placeholder. This is the alias
  // ENG-1111 named as unguessable — the backend `provider` now sections it (see
  // SECTION_BY_PROVIDER), but the section and the icon are separate signals, and
  // only the maker drives the icon.
  { key: 'meta', name: 'Meta', test: /\bllama\b|\bmuse\b/ },
];

export const OTHER_MAKER = { key: 'other', name: 'Other' };

// ─── Picker sections ────────────────────────────────────────────────
//
// Makers are the *icon* identity (one mark per company). Sections are the
// coarser thing the picker actually lists under a heading: the labs that most
// users pick by name get their own section, and the open-weight models are
// collected into one, because "which lab trained this open-weight model" is a
// finer distinction than the choice a user is making at this menu.
//
// Two makers are deliberately NOT in Open Weight, because the section is a claim
// about the model rather than about the company:
//
//   - xAI. Grok is not open weight.
//   - Meta. It publishes open-weight models (Llama) *and* proprietary ones, and
//     the only Meta model in the catalog is Muse Spark, which is not open weight.
//     So "Meta" alone cannot decide the section. If a Llama model is ever served,
//     it wants Open Weight and should be matched on the model, not on the maker.
//
// Both therefore fall through to Other, along with anything unrecognised.
//
// Declaration order = section display order.
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

/** Every section a lookup can resolve to, Other included. */
const ALL_SECTIONS = [...SECTIONS, OTHER_SECTION];

/** maker key → section, for every maker a section claims. */
const SECTION_BY_MAKER = new Map(
  SECTIONS.flatMap((section) => section.makers.map((maker) => [maker, section])),
);

// Backend `provider` values (MindsHub's policy) → the section they belong to.
// `fireworks` is a *host*, not a maker — it serves several open-weight models —
// which is exactly why the backend field decides the section while the icon
// keeps coming from the per-model maker inference below.
//
// `meta` maps to Other, not Open Weight: the Meta model MindsHub serves is Muse
// Spark, which is not open weight (see the SECTIONS note above).
const SECTION_BY_PROVIDER = new Map([
  ['anthropic', 'anthropic'],
  ['openai', 'openai'],
  ['gemini', 'google'],
  ['fireworks', 'open-weight'],
  ['moonshot', 'open-weight'],
  ['meta', 'other'],
]);

/**
 * The picker section an option belongs under.
 *
 * Precedence, and the reason for it:
 *
 *   1. A model whose maker infers as MindsHub stays in the MindsHub section
 *      whatever the backend says its provider is. MindsHub Air is sold as
 *      MindsHub's own model and the engine behind it is expected to change, so
 *      filing it under whichever vendor currently serves it would be unstable
 *      and beside the point.
 *   2. The backend `provider` (authoritative — it comes from MindsHub's policy).
 *   3. Inference from the alias/label, for every provider that publishes no
 *      `provider` field at all (BYOK endpoints, older cowork-server).
 *
 * An unrecognised provider or maker lands in Other, so a new one appearing in
 * the policy never needs an app release to be listed somewhere sensible.
 */
export function modelSection(option) {
  const maker = option?.maker || modelMaker(option?.value, option?.label).key;
  if (maker === 'mindshub') return SECTION_BY_MAKER.get('mindshub');
  // Resolved against ALL_SECTIONS, not SECTIONS: a provider may map to Other
  // deliberately (`meta`), and that has to find a section rather than fall
  // through as if the provider were unrecognised.
  const byProvider = option?.provider && SECTION_BY_PROVIDER.get(option.provider);
  if (byProvider) return ALL_SECTIONS.find((s) => s.key === byProvider) || OTHER_SECTION;
  return SECTION_BY_MAKER.get(maker) || OTHER_SECTION;
}

/**
 * Infer the maker of a model from its id/alias and display label.
 * First declared match wins. Unknown → OTHER_MAKER.
 *
 *   modelMaker('gpt-codex', 'GPT 5.3 Codex')   → { key: 'openai', … }
 *   modelMaker('fable', 'Claude Fable 5')      → { key: 'anthropic', … }
 *   modelMaker('muse-spark', 'Muse Spark 1.1') → { key: 'other', … }
 *
 * Aliases use `_`, `-`, `.` and spaces as separators; normalising them all
 * to spaces lets one word-boundary regex per maker cover id and label.
 */
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
 *   Flat option list. `provider` is MindsHub's authoritative maker field (the
 *   ENG-1111 contract) and decides the section; `maker`, explicit or inferred,
 *   stays the *icon* identity, so collapsing several makers into one section
 *   never costs a model its own mark.
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
