import { describe, it, expect } from 'vitest';
import { modelMaker, groupModelOptions, OTHER_MAKER } from './modelCatalog';

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
    expect(modelMaker('muse-spark', 'Muse Spark 1.1')).toBe(OTHER_MAKER);
    expect(modelMaker('', '')).toBe(OTHER_MAKER);
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
