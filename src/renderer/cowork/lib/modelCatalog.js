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
  { key: 'meta', name: 'Meta', test: /\bllama\b/ },
];

export const OTHER_MAKER = { key: 'other', name: 'Other' };

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
 * Group flat picker options by maker, ready for the ModelSelect popup.
 *
 * @param {Array<{value: string, label: string, maker?: string, makerName?: string}>} options
 *   Flat option list. An option carrying an explicit `maker` key (the
 *   future ENG-1111 backend field) is trusted verbatim; otherwise the
 *   maker is inferred from value + label. A `maker` we ship no MAKERS
 *   entry for still gets its own group — named by `makerName` (falling
 *   back to a capitalised key) with ProviderIcon's placeholder mark — so
 *   a new backend maker never needs a frontend release to group correctly.
 * @returns {Array<{key: string, name: string, items: object[]}>}
 *   Groups in MAKERS declaration order, then dynamic makers in first-seen
 *   order, Other last; empty groups dropped; option order preserved within
 *   each group.
 */
export function groupModelOptions(options) {
  const byKey = new Map();
  const dynamic = new Map();
  for (const opt of options || []) {
    if (!opt) continue;
    let maker;
    if (opt.maker && opt.maker !== OTHER_MAKER.key) {
      maker = MAKERS.find((m) => m.key === opt.maker) || dynamic.get(opt.maker);
      if (!maker) {
        maker = { key: opt.maker, name: opt.makerName || opt.maker.charAt(0).toUpperCase() + opt.maker.slice(1) };
        dynamic.set(maker.key, maker);
      }
    } else if (opt.maker) {
      maker = OTHER_MAKER;
    } else {
      maker = modelMaker(opt.value, opt.label);
    }
    if (!byKey.has(maker.key)) byKey.set(maker.key, []);
    byKey.get(maker.key).push(opt);
  }
  return [...MAKERS, ...dynamic.values(), OTHER_MAKER]
    .filter((m) => byKey.has(m.key))
    .map((m) => ({ key: m.key, name: m.name, items: byKey.get(m.key) }));
}
