import { describe, expect, it } from 'vitest';

import {
  MODEL_DEFAULT_VALUE,
  effortLabel,
  effortLevelsFor,
  effortOptions,
  projectEffortOptions,
  requestedEffort,
  resolveEffort,
} from './reasoning';

// What MindsHub advertised on 2026-09-03: each family has its own vocabulary.
const catalog = {
  gpt: { efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], default: 'medium' },
  gemini: { efforts: ['low', 'medium', 'high'], default: 'high' },
  odd: { efforts: ['fast', 'slow'], default: 'missing' },
  empty: { efforts: [], default: 'low' },
};


describe('effort levels come from the model catalog', () => {
  it('offers exactly what the model advertises, in its order, with its default', () => {
    expect(effortLevelsFor('gpt', catalog)).toEqual({ levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], modelDefault: 'medium' });
    expect(effortLevelsFor('gemini', catalog)).toEqual({ levels: ['low', 'medium', 'high'], modelDefault: 'high' });
  });

  it('offers nothing for a model without levels or before the catalog has loaded', () => {
    expect(effortLevelsFor('haiku', catalog)).toBeNull();
    expect(effortLevelsFor('empty', catalog)).toBeNull();
    expect(effortLevelsFor('gpt', undefined)).toBeNull();
  });

  it('ignores a default the model does not actually offer', () => {
    expect(effortLevelsFor('odd', catalog)?.modelDefault).toBeNull();
  });

  it('labels a level the way the gateway names it, only capitalised', () => {
    expect(effortLabel('xhigh')).toBe('Xhigh');
    expect(effortLabel('max')).toBe('Max');
    expect(effortLabel('')).toBe('');
  });
});


describe('resolving the level a task runs at', () => {
  const gemini = effortLevelsFor('gemini', catalog)!;

  it('prefers the chosen level, then the project default, then the model default', () => {
    expect(resolveEffort('low', 'medium', gemini)).toBe('low');
    expect(resolveEffort(null, 'medium', gemini)).toBe('medium');
    expect(resolveEffort(null, null, gemini)).toBe('high');
  });

  it('skips a chosen or project level the model does not offer', () => {
    expect(resolveEffort('max', null, gemini)).toBe('high');
    expect(resolveEffort(null, 'max', gemini)).toBe('high');
    expect(resolveEffort('max', 'low', gemini)).toBe('low');
  });

  it('only names a level in the request when the task or project chose one', () => {
    expect(requestedEffort('low', null, gemini)).toBe('low');
    expect(requestedEffort(null, 'medium', gemini)).toBe('medium');
    expect(requestedEffort(null, 'max', gemini)).toBeNull();
    expect(requestedEffort(null, null, gemini)).toBeNull();
  });
});


describe('picker options', () => {
  const gpt = effortLevelsFor('gpt', catalog)!;

  it('mark the model default and the project default without inventing levels', () => {
    const options = effortOptions(gpt, 'max');
    expect(options.map((option) => option.value)).toEqual(gpt.levels);
    expect(options.find((option) => option.value === 'medium')).toMatchObject({ triggerLabel: 'Medium effort', description: 'Model default' });
    expect(options.find((option) => option.value === 'max')).toMatchObject({ label: 'Max', description: 'Project default' });
    expect(options.find((option) => option.value === 'low')?.description).toBeUndefined();
  });

  it('lead the project settings list with "Model default" naming that default', () => {
    const options = projectEffortOptions(gpt);
    expect(options[0]).toEqual({ value: MODEL_DEFAULT_VALUE, label: 'Model default', description: 'Medium' });
    expect(options.slice(1).map((option) => option.value)).toEqual(gpt.levels);
  });
});
