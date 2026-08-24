import { describe, it, expect } from 'vitest';
import {
  modelMaker, groupModelOptions, hasFrozenVersions, isModelLocked, orderByFamily, OTHER_MAKER,
} from './modelCatalog';

// The live minds-cloud catalog as of ENG-1096 (alias → MindsHub label).
const CATALOG = [
  ['grok', 'Grok 4.5', 'xai'],
  ['gpt-codex', 'GPT 5.3 Codex', 'openai'],
  ['kimi', 'Kimi K3', 'moonshot'],
  ['haiku', 'Claude Haiku 4.5', 'anthropic'],
  ['qwen', 'Qwen3.7 Plus', 'alibaba'],
  ['sonnet', 'Claude Sonnet 5', 'anthropic'],
  ['fable', 'Claude Fable 5', 'anthropic'],
  ['gpt-terra', 'GPT 5.6 Terra', 'openai'],
  ['mindshub_air', 'MindsHub Air', 'mindshub'],
  ['gpt-mini', 'GPT 5.4 Mini', 'openai'],
  ['gpt-nano', 'GPT 5.4 Nano', 'openai'],
  ['gpt-luna', 'GPT 5.6 Luna', 'openai'],
  ['gemini', 'Gemini 3.1 Pro Preview', 'google'],
  ['gemini-flash', 'Gemini 3.6 Flash', 'google'],
  ['deepseek', 'DeepSeek V4 Pro', 'deepseek'],
  ['gpt', 'GPT 5.6 Sol', 'openai'],
  ['opus', 'Claude Opus 5', 'anthropic'],
  ['glm', 'GLM 5.2', 'zai'],
];

describe('modelMaker', () => {
  it.each(CATALOG)('%s (%s) → %s', (id, label, expected) => {
    expect(modelMaker(id, label).key).toBe(expected);
  });

  it('classifies BYOK provider ids without a label', () => {
    expect(modelMaker('claude-opus-4-8').key).toBe('anthropic');
    expect(modelMaker('claude-haiku-4-5-20251001').key).toBe('anthropic');
    expect(modelMaker('gpt-5.5-mini').key).toBe('openai');
    expect(modelMaker('o4-mini').key).toBe('openai');
    expect(modelMaker('o3').key).toBe('openai');
    expect(modelMaker('gemini-2.5-pro').key).toBe('google');
    expect(modelMaker('mistral-large').key).toBe('mistral');
    expect(modelMaker('llama-4-70b').key).toBe('meta');
  });

  it('sends unknown models to Other instead of guessing wrong', () => {
    // `muse-spark` used to be the example here. It now matches Meta deliberately —
    // it is Meta's model, and matching it is what earns it a real icon instead of
    // the placeholder — so this needs a genuinely unrecognisable alias.
    expect(modelMaker('zephyr-base', 'Zephyr Base 2')).toBe(OTHER_MAKER);
    expect(modelMaker('', '')).toBe(OTHER_MAKER);
  });

  it('infers Meta for Muse Spark, so it gets a mark rather than the placeholder', () => {
    expect(modelMaker('muse-spark', 'Muse Spark 1.1').key).toBe('meta');
  });

  it('does not read "o" words as OpenAI o-series', () => {
    // "grok 4" must not trip the /o\d/ matcher via coincidence.
    expect(modelMaker('grok', 'Grok 4.5').key).toBe('xai');
    expect(modelMaker('command-r', 'Command R7B').key).toBe('other');
  });
});

describe('groupModelOptions', () => {
  const options = CATALOG.map(([value, label]) => ({ value, label }));

  it('groups into sections in declaration order, MindsHub first', () => {
    // Sections, not one group per maker: the labs users pick by name get their
    // own, the open-weight models collect into one, and xAI is not among them
    // (Grok isn't open weight) so it falls through to Other.
    const groups = groupModelOptions(options);
    expect(groups.map((g) => g.key)).toEqual([
      'mindshub', 'anthropic', 'openai', 'google', 'open-weight', 'other',
    ]);
    expect(groups.map((g) => g.name)).toEqual([
      'MindsHub', 'Anthropic', 'OpenAI', 'Google', 'Open Weight', 'Other',
    ]);
  });

  it('collects the open-weight makers into one section', () => {
    const groups = groupModelOptions(options);
    const openWeight = groups.find((g) => g.key === 'open-weight');
    // Moonshot / Alibaba / DeepSeek / Z.ai models share a heading; each keeps its
    // own maker, so each still gets its own icon.
    expect(openWeight.items.length).toBeGreaterThan(1);
    expect(new Set(openWeight.items.map((o) => modelMaker(o.value, o.label).key)).size)
      .toBeGreaterThan(1);
  });

  it('leaves xAI out of Open Weight', () => {
    const groups = groupModelOptions([{ value: 'grok', label: 'Grok 4.5' }]);
    expect(groups.map((g) => g.key)).toEqual(['other']);
  });

  it('leaves Meta out of Open Weight', () => {
    // The section is a claim about the model, not the company: Meta publishes
    // open-weight models AND proprietary ones, and the Meta model MindsHub serves
    // is Muse Spark, which is not open weight.
    const groups = groupModelOptions([
      { value: 'muse-spark', label: 'Muse Spark 1.1', provider: 'meta' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['other']);
  });

  it('sections muse-spark from the backend provider and still gives it Meta\'s icon', () => {
    // The case ENG-1111 named as unguessable. Section and icon are separate
    // signals: `provider: meta` puts it in Other, while the maker gives it a real
    // mark instead of the neutral placeholder.
    const opt = { value: 'muse-spark', label: 'Muse Spark 1.1', provider: 'meta' };
    expect(groupModelOptions([opt]).map((g) => g.key)).toEqual(['other']);
    expect(modelMaker(opt.value, opt.label).key).toBe('meta');
  });

  it('keeps option order within a group', () => {
    const groups = groupModelOptions(options);
    const anthropic = groups.find((g) => g.key === 'anthropic');
    expect(anthropic.items.map((o) => o.value)).toEqual(['haiku', 'sonnet', 'fable', 'opus']);
  });

  it('drops empty groups and puts unknowns in Other last', () => {
    const groups = groupModelOptions([
      { value: 'muse-spark', label: 'Muse Spark 1.1' },
      { value: 'sonnet', label: 'Claude Sonnet 5' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['anthropic', 'other']);
  });

  it('trusts an explicit maker field over inference (ENG-1111 forward-compat)', () => {
    const groups = groupModelOptions([
      { value: 'muse-spark', label: 'Muse Spark 1.1', maker: 'mindshub' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['mindshub']);
  });

  it('puts a maker no section claims into Other rather than its own heading', () => {
    // Replaces the earlier per-maker "dynamic group" behaviour: with a fixed set
    // of sections, an unrecognised maker or provider is listed under Other. Still
    // no app release needed for a new one to appear — just not its own heading.
    const groups = groupModelOptions([
      { value: 'x', label: 'X', maker: 'somebody-new' },
      { value: 'y', label: 'Y', maker: 'acme' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['other']);
    expect(groups[0].items.map((o) => o.value)).toEqual(['x', 'y']);
  });

  it('sections by the backend provider, which outranks alias inference', () => {
    // `provider` is MindsHub's authoritative field. `fireworks` is a host that
    // serves several open-weight models, which is why it maps to a section rather
    // than to a maker/icon.
    const groups = groupModelOptions([
      { value: 'some-alias', label: 'Some Alias', provider: 'fireworks' },
      { value: 'another', label: 'Another', provider: 'gemini' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['google', 'open-weight']);
  });

  it('keeps a MindsHub-branded model in MindsHub whatever provider the backend reports', () => {
    // Air is sold as MindsHub's own model and the engine behind it is expected to
    // change, so it must not follow whichever vendor currently serves it.
    const groups = groupModelOptions([
      { value: 'mindshub_air', label: 'MindsHub Air', provider: 'anthropic' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['mindshub']);
  });

  it('routes an explicit maker of "other" to the Other section, not a duplicate', () => {
    const groups = groupModelOptions([
      { value: 'muse-spark', label: 'Muse Spark 1.1' },
      { value: 'x', label: 'X', maker: 'other' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['other']);
    expect(groups[0].items.map((o) => o.value)).toEqual(['muse-spark', 'x']);
  });

  it('ignores null/undefined entries', () => {
    expect(groupModelOptions([null, undefined])).toEqual([]);
    expect(groupModelOptions()).toEqual([]);
  });
});

// ─── Families: which alias moves, and which version sits under which head ───
//
// Both pickers read these, so a rule that disagrees with itself shows up twice.

describe('hasFrozenVersions', () => {
  it('is true when a listed version froze a listed head', () => {
    expect(hasFrozenVersions(['sonnet', 'sonnet-4-5'], { sonnet: 'sonnet', 'sonnet-4-5': 'sonnet' })).toBe(true);
  });

  it('ignores a pin whose head is not in the list', () => {
    // A typo'd family in the policy, or a head filtered out upstream. The pin renders
    // with no marker of its own, so it must not turn the moving-alias marker on for
    // the rows around it either.
    expect(hasFrozenVersions(['sonnet', 'sonnet-4-5'], { sonnet: 'sonnet', 'sonnet-4-5': 'sonet' })).toBe(false);
  });

  it('is false for an all-moving list, and with no families at all', () => {
    expect(hasFrozenVersions(['sonnet', 'kimi'], { sonnet: 'sonnet', kimi: 'kimi' })).toBe(false);
    expect(hasFrozenVersions(['sonnet', 'kimi'])).toBe(false);
    expect(hasFrozenVersions()).toBe(false);
  });
});

describe('orderByFamily', () => {
  it('nests a chain under the alias at the top of it', () => {
    // Two levels: `sonnet-4-1` froze `sonnet-4-5`, which froze `sonnet`. Walking one
    // level left the deepest version to the final sweep, which appended it after the
    // unrelated `opus` family — under a sibling it has nothing to do with.
    expect(orderByFamily(
      ['sonnet', 'sonnet-4-5', 'sonnet-4-1', 'opus', 'opus-4-1'],
      {
        sonnet: 'sonnet', 'sonnet-4-5': 'sonnet', 'sonnet-4-1': 'sonnet-4-5',
        opus: 'opus', 'opus-4-1': 'opus',
      },
    )).toEqual(['sonnet', 'sonnet-4-5', 'sonnet-4-1', 'opus', 'opus-4-1']);
  });

  it('keeps heads in the incoming order and moves only the versions', () => {
    // The gateway's order is meaningful upstream (free/baseline model first).
    expect(orderByFamily(
      ['sonnet', 'kimi', 'sonnet-4-5'],
      { sonnet: 'sonnet', kimi: 'kimi', 'sonnet-4-5': 'sonnet' },
    )).toEqual(['sonnet', 'sonnet-4-5', 'kimi']);
  });

  it('stays a permutation on a cycle, where nothing roots the walk', () => {
    // A dropped id is a model the user can no longer select, and for a persisted
    // selection a desync. Cycles reach the app through a Statsig edit with no deploy
    // and no validation of the family target.
    expect(orderByFamily(['a', 'b'], { a: 'b', b: 'a' })).toEqual(['a', 'b']);
    expect(orderByFamily(['a', 'b', 'c'], { a: 'b', b: 'a', c: 'a' }).slice().sort())
      .toEqual(['a', 'b', 'c']);
  });
});

// ─── isModelLocked — the one definition of "the wallet can't pay for this",
// read by the Settings picker and the composer's menu so the two can never
// disagree about which rows a user is allowed to choose.
describe('isModelLocked', () => {
  it('locks a model the availability map flags false', () => {
    expect(isModelLocked({ fable: false }, 'fable')).toBe(true);
  });

  it('leaves a model the map flags true alone', () => {
    expect(isModelLocked({ fable: true }, 'fable')).toBe(false);
  });

  // Absent means available, deliberately. Every BYOK provider has no such map,
  // and an older gateway publishes no flag for a model it does serve, so
  // reading absence as locked would empty those pickers.
  it('treats an id the map does not mention as available', () => {
    expect(isModelLocked({ fable: false }, 'sonnet')).toBe(false);
    expect(isModelLocked({}, 'sonnet')).toBe(false);
    expect(isModelLocked(undefined, 'sonnet')).toBe(false);
    expect(isModelLocked(null, 'sonnet')).toBe(false);
  });

  // The map is written from real booleans. A stringy value would make
  // `!value` read "false" as available and, worse, a truthy "false" lock
  // nothing, so the test pins the strict comparison rather than the coercion.
  it('only a real false locks, never a falsy lookalike', () => {
    expect(isModelLocked({ fable: 0 }, 'fable')).toBe(false);
    expect(isModelLocked({ fable: 'false' }, 'fable')).toBe(false);
  });
});
