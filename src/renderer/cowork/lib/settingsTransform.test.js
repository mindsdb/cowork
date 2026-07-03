import { describe, it, expect } from 'vitest';
import { modelLabel, recommendedModelOptions } from './settingsTransform';

describe('modelLabel', () => {
  it('derives from the id with no per-model special-casing (display name comes from config)', () => {
    expect(modelLabel('latest:kimi')).toBe('latest:kimi');
  });

  it('still derives family-aware labels for other models', () => {
    expect(modelLabel('claude-opus-4-8')).toBe('Claude Opus 4.8');
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Claude Haiku 4.5');
    expect(modelLabel('gpt-5.5-mini')).toBe('GPT-5.5 Mini');
    expect(modelLabel('gemini-3-flash-preview')).toBe('Gemini 3 Flash Preview');
  });

  it('returns an empty string for a missing id', () => {
    expect(modelLabel('')).toBe('');
    expect(modelLabel(undefined)).toBe('');
  });
});

describe('recommendedModelOptions', () => {
  it('maps a provider id-string list to {id, label} options (label derived from id)', () => {
    const rec = { 'minds-cloud': ['latest:kimi', 'latest:opus'] };
    expect(recommendedModelOptions(rec, 'minds-cloud')).toEqual([
      { id: 'latest:kimi', label: 'latest:kimi' },
      { id: 'latest:opus', label: 'latest:opus' },
    ]);
  });

  it('prefers a config-provided label over the id-derived one', () => {
    const rec = { 'minds-cloud': [{ id: 'latest:kimi', label: 'MindsHub Air' }] };
    expect(recommendedModelOptions(rec, 'minds-cloud')).toEqual([
      { id: 'latest:kimi', label: 'MindsHub Air' },
    ]);
  });

  it('returns [] for an unknown or empty provider', () => {
    expect(recommendedModelOptions({}, 'minds-cloud')).toEqual([]);
    expect(recommendedModelOptions(null, 'minds-cloud')).toEqual([]);
  });

  it('passes a server-provided locked flag through (forward-compat for ENG-531)', () => {
    const rec = {
      'minds-cloud': [
        { id: 'latest:kimi', locked: false },
        { id: 'latest:opus', locked: true },
      ],
    };
    expect(recommendedModelOptions(rec, 'minds-cloud')).toEqual([
      { id: 'latest:kimi', label: 'latest:kimi', locked: false },
      { id: 'latest:opus', label: 'latest:opus', locked: true },
    ]);
  });

  it('omits locked when the entry is a plain id string', () => {
    const [opt] = recommendedModelOptions({ x: ['latest:opus'] }, 'x');
    expect(opt).toEqual({ id: 'latest:opus', label: 'latest:opus' });
    expect('locked' in opt).toBe(false);
  });
});
