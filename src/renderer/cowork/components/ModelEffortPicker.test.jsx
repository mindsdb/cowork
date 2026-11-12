// The bar's default effort (ENG-4227): medium where the model offers it.
import { describe, expect, it, vi } from 'vitest';

// The operator's allowed efforts (lib/modelPicker reads them from a page tag
// only in a build without platform UI, which this suite is not).
const allowed = vi.hoisted(() => ({ models: { opus: ['medium', 'high'] }, operatorDefault: ['low'] }));
vi.mock('../../lib/modelPicker', () => ({
  modelPickerMode: () => 'off',
  operatorEffortLevels: (model) => (model === null ? allowed.operatorDefault : allowed.models[model] || []),
}));

import { pickedEffort } from './ModelEffortPicker';

const modelMeta = {
  modelEfforts: {
    sonnet: { efforts: ['low', 'medium', 'high'], default: 'high' },
    gemini: { efforts: ['low', 'high'], default: 'high' },
  },
  planningReasoningEffort: 'low',
};

describe('pickedEffort with platform UI', () => {
  it('defaults to medium on a model that offers it', () => {
    expect(pickedEffort({ model: { id: 'sonnet' }, modelMeta, operatorPicker: false })).toBe('medium');
  });
  it('keeps a pick the model offers', () => {
    expect(pickedEffort({ model: { id: 'sonnet' }, effort: 'high', modelMeta, operatorPicker: false })).toBe('high');
  });
  it('falls back to what the composer shows when medium is not offered', () => {
    expect(pickedEffort({ model: { id: 'gemini' }, modelMeta, operatorPicker: false })).toBe('low');
  });
  it('sends none for a model without levels, or Model Router', () => {
    expect(pickedEffort({ model: { id: 'plain' }, modelMeta, operatorPicker: false })).toBe('');
    expect(pickedEffort({ model: { id: 'model-router' }, modelMeta, operatorPicker: false })).toBe('');
  });
});

describe("pickedEffort under the operator's picker", () => {
  it('defaults to medium where the operator allows it, and keeps Default', () => {
    expect(pickedEffort({ model: { id: 'opus' }, operatorPicker: true })).toBe('medium');
    expect(pickedEffort({ model: { id: 'opus' }, effort: '', operatorPicker: true })).toBe('');
    expect(pickedEffort({ model: { id: 'opus' }, effort: 'high', operatorPicker: true })).toBe('high');
    expect(pickedEffort({ model: { id: 'model-router' }, operatorPicker: true })).toBe('');
  });
});
