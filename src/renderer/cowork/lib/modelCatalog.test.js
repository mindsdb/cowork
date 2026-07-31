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

  it('groups by maker in declaration order, MindsHub first, Other absent when empty', () => {
    const groups = groupModelOptions(options);
    expect(groups.map((g) => g.key)).toEqual([
      'mindshub', 'openai', 'anthropic', 'google', 'xai', 'moonshot', 'alibaba', 'deepseek', 'zai',
    ]);
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

  it('gives an explicit but unrecognised maker its own group (dynamic maker, ENG-1111)', () => {
    const groups = groupModelOptions([
      { value: 'x', label: 'X', maker: 'somebody-new', makerName: 'Somebody New' },
      { value: 'y', label: 'Y', maker: 'acme' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['somebody-new', 'acme']);
    expect(groups.map((g) => g.name)).toEqual(['Somebody New', 'Acme']);
  });

  it('orders dynamic makers after known makers and before Other', () => {
    const groups = groupModelOptions([
      { value: 'muse-spark', label: 'Muse Spark 1.1' },
      { value: 'x', label: 'X', maker: 'acme' },
      { value: 'sonnet', label: 'Claude Sonnet 5' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['anthropic', 'acme', 'other']);
  });

  it('routes an explicit maker of "other" to the Other group, not a duplicate', () => {
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
