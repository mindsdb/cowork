// Model → maker (the company that trains the model) inference + grouping
// for the model picker (ENG-1096).
//
// The backend names the vendor that serves a model, not the company that
// trained it: a `/v1/models` row carries MindsHub's policy `provider`
// (`anthropic`, `fireworks`, `meta`, …), which is what decides the picker
// section (see SECTION_BY_PROVIDER). The maker stays inferred from the alias +
// label the same way `modelLabel` derives display names — pure, family-aware,
// and resilient to new versions — because a host like `fireworks` serves
// several companies' models and so cannot supply the mark. An alias that
// matches nothing lands in the "Other" bucket rather than a wrong group, and an
// option carrying an explicit `maker` key skips the inference entirely.

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

// Sentinel model "id" for the composer's default pick: defer to whatever
// this account's Settings has configured (planning/coding/router model),
// rather than pinning one specific model for the task. Never a real model
// id and never sent to the backend as-is — api.js's _streamResponse
// translates it to `model: null`, which cowork-server already treats as
// "use account settings" (see ResponsesRequest.model in cowork-server).
export const MODEL_ROUTER_ID = 'model-router';
export const MODEL_ROUTER_LABEL = 'Model Router';
export const MODEL_ROUTER = {
  id: MODEL_ROUTER_ID,
  name: MODEL_ROUTER_LABEL,
  desc: "Routes to this account's configured model automatically",
};

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

/**
 * MindsHub Air's model id, named once so a rename is one edit rather than a hunt
 * for string literals that must all agree. App.jsx carries its own copy for the
 * "Switch to MindsHub Air" escape hatch and should import this one instead.
 */
export const MINDSHUB_AIR_MODEL_ID = 'mindshub_air';

/**
 * MindsHub's own models, by id.
 *
 * Keyed on id rather than inferred from the name because auth cannot tell us:
 * `mindshub` is not a member of the policy's `provider` enum, so no value of that
 * field ever means "this one is ours". Adding a branded model here is a deliberate
 * one-line edit; the alternative — matching our name against the id and label — is
 * a rule that silently stops working the day a branded model isn't named after us.
 */
export const MINDSHUB_MODEL_IDS = new Set([MINDSHUB_AIR_MODEL_ID]);

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
  // Our own models are matched by id first. `mindshub` is NOT a value auth's
  // provider enum can carry, so auth structurally cannot say "this model is
  // ours" — and falling back to the maker regex means the MindsHub section works
  // only because our models happen to be named after us. Rename Air, or add a
  // sibling whose id and label don't say "mindshub", and our flagship would file
  // under whichever vendor currently serves it. The id is the stable thing: it is
  // the public API contract and cannot change without breaking callers.
  if (MINDSHUB_MODEL_IDS.has(option?.value)) return SECTION_BY_MAKER.get('mindshub');
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

// ─── Model families (moving aliases vs frozen versions) ─────────────
//
// One implementation, used by both pickers. These rules lived twice — once over
// id strings in settingsTransform and once over `{id, name}` objects in the
// composer — and the duplication is how they drifted: a fix had to be written in
// two shapes, so the bug below was live in both.
//
// `families` maps a model id to the moving alias it belongs to. cowork-server
// emits it densely for every model it describes, so:
//
//   families[id] === id   → a moving alias; picking it always gets the newest
//   families[id] !== id   → a frozen version of families[id]
//   families[id] absent   → NOT DESCRIBED by this map at all
//
// That last case is the one that matters and the one that was wrong. The map is
// global to the settings blob while the list rendered is per-provider, so for a
// BYOK role every id is absent. Deriving "moving" from `families[id] || id`
// treats absent as "is its own head" and tags every BYOK model as the latest —
// including dated snapshots that provably never move. Presence is the signal;
// global non-emptiness is not.

/** True when `id` is a moving alias according to `families`. */
export function isMovingAlias(id, families = {}) {
  return !!families && families[id] === id;
}

/** True when `id` is a frozen version of some other alias. */
export function isFrozenAlias(id, families = {}) {
  return !!families && !!families[id] && families[id] !== id;
}

/**
 * True when at least one id in `ids` is a frozen version of a head that is ALSO in
 * `ids`.
 *
 * The head has to be listed, so this agrees with the rule the callers use to decide
 * a pin sits under its head. An orphaned pin — a typo'd `family`, or a head filtered
 * out upstream — renders with no marker of its own, so counting it here turned the
 * moving-alias marker on for every other row while the pin that triggered it showed
 * nothing.
 */
export function hasFrozenVersions(ids, families = {}) {
  const list = ids || [];
  return list.some((id) => isFrozenAlias(id, families) && list.includes(families[id]));
}

/**
 * Order ids so each frozen version follows the alias it froze.
 *
 * Heads keep their position in the incoming order, which is meaningful upstream
 * (the gateway lists the free/baseline model first); only frozen versions move, to
 * sit under their head.
 *
 * **Total by construction.** Every input id appears exactly once in the output, so
 * the result is always a permutation of the input. That is load-bearing rather than
 * tidy: `resolveModelPickerValue` resolves the stored model against the unordered
 * list, so an id dropped here yields `showStalePin === false` with no rendered
 * option — the ENG-739 desync class. A family chain (`c → b → a`) or a two-key
 * cycle (`a → b → a`) both dropped models before the final sweep existed, and a
 * Statsig edit reaches the app with no deploy and no cross-reference validation on
 * the target, so neither shape is merely theoretical.
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
