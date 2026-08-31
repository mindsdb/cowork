import { describe, expect, it } from 'vitest';
import { buildModelPickerOptions, withModelPickerFallback } from './modelPickerOptions';

describe('buildModelPickerOptions', () => {
  it('produces the same provider, family, version, and wallet metadata for every picker', () => {
    const models = [
      { id: 'sonnet-4-5', name: 'Claude Sonnet 4.5' },
      { id: 'mindshub_air', name: 'MindsHub Air' },
      { id: 'sonnet', name: 'Claude Sonnet 5' },
    ];

    expect(buildModelPickerOptions(models, {
      modelProviders: { mindshub_air: 'openai', sonnet: 'anthropic', 'sonnet-4-5': 'anthropic' },
      modelFamilies: { mindshub_air: 'mindshub_air', sonnet: 'sonnet', 'sonnet-4-5': 'sonnet' },
      modelEnabled: { mindshub_air: true, sonnet: false, 'sonnet-4-5': false },
    })).toEqual([
      { value: 'mindshub_air', label: 'MindsHub Air', tag: 'Latest', provider: 'openai' },
      {
        value: 'sonnet',
        label: 'Claude Sonnet 5',
        disabled: true,
        locked: true,
        tag: 'Latest · Needs credits',
        provider: 'anthropic',
      },
      {
        value: 'sonnet-4-5',
        label: 'Claude Sonnet 4.5',
        disabled: true,
        locked: true,
        tag: 'Older version · Needs credits',
        provider: 'anthropic',
      },
    ]);
  });

  it('keeps an unannotated catalog usable', () => {
    expect(buildModelPickerOptions([{ id: 'custom', name: 'Custom model' }])).toEqual([
      { value: 'custom', label: 'Custom model' },
    ]);
  });
});

describe('withModelPickerFallback', () => {
  it('keeps the configured model usable when the live catalog is empty', () => {
    expect(withModelPickerFallback([], 'gpt-5.6-sol', 'GPT 5.6 Sol')).toEqual([
      { id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' },
    ]);
  });

  it('does not duplicate a model already present in the live catalog', () => {
    const models = [{ id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' }];
    expect(withModelPickerFallback(models, 'gpt-5.6-sol')).toEqual(models);
  });
});
