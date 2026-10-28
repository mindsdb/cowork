import { describe, expect, it } from 'vitest';
import { buildModelPickerOptions, offeredModelId, offeredModels, withModelPickerFallback } from './modelPickerOptions';
import { MODEL_ROUTER_ID } from './modelCatalog';

describe('buildModelPickerOptions', () => {
  it('produces the same provider, family order, and wallet metadata for every picker', () => {
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
      { value: 'mindshub_air', label: 'MindsHub Air', provider: 'openai' },
      {
        value: 'sonnet',
        label: 'Claude Sonnet 5',
        disabled: true,
        locked: true,
        tag: 'Needs credits',
        provider: 'anthropic',
      },
      {
        value: 'sonnet-4-5',
        label: 'Claude Sonnet 4.5',
        disabled: true,
        locked: true,
        tag: 'Needs credits',
        provider: 'anthropic',
      },
    ]);
  });

  it('tags a row an admin restricted, with no credits route, while wallet rows keep Needs credits', () => {
    const models = [
      { id: 'mindshub_air', name: 'MindsHub Air' },
      { id: 'opus', name: 'Claude Opus 5' },
      { id: 'fable', name: 'Claude Fable 5' },
      { id: 'sonnet', name: 'Claude Sonnet 5' },
    ];
    const options = buildModelPickerOptions(models, {
      modelEnabled: { mindshub_air: true, opus: false, fable: false, sonnet: false },
      // sonnet has no reason: an older server, or one the map missed.
      modelDisabledReasons: { opus: 'model_restricted', fable: 'wallet_empty' },
    });
    const byValue = Object.fromEntries(options.map((o) => [o.value, o]));
    expect(byValue.opus).toEqual({
      value: 'opus',
      label: 'Claude Opus 5',
      disabled: true,
      restricted: true,
      tag: 'Restricted',
      title: 'An admin in your organization restricted this model.',
    });
    expect(byValue.fable).toEqual({ value: 'fable', label: 'Claude Fable 5', disabled: true, locked: true, tag: 'Needs credits' });
    expect(byValue.sonnet).toEqual({ value: 'sonnet', label: 'Claude Sonnet 5', disabled: true, locked: true, tag: 'Needs credits' });
    expect(byValue.mindshub_air).toEqual({ value: 'mindshub_air', label: 'MindsHub Air' });
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

describe('offeredModels', () => {
  const models = [
    { id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna' },
    { id: 'opus-5-5', name: 'Opus 5.5' },
    { id: 'gpt-luna-5-6', name: 'GPT Luna 5.6' },
  ];

  it('leaves out each model the catalog lists as not enabled', () => {
    expect(offeredModels(models, { 'gpt-5.6-luna': true, 'opus-5-5': true, 'gpt-luna-5-6': false }))
      .toEqual(models.slice(0, 2));
  });

  it('keeps a model the catalog says nothing about', () => {
    expect(offeredModels(models, { 'gpt-luna-5-6': false })).toEqual(models.slice(0, 2));
  });

  it('offers nothing before the catalog loads', () => {
    expect(offeredModels(undefined, undefined)).toEqual([]);
  });
});

describe('offeredModelId', () => {
  const offered = [{ id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna' }, { id: 'opus-5-5', name: 'Opus 5.5' }];

  it('keeps an offered model', () => {
    expect(offeredModelId('opus-5-5', offered)).toBe('opus-5-5');
  });

  it("sends a model the picker no longer offers as the operator's own", () => {
    expect(offeredModelId('gpt-luna-5-6', offered)).toBe(MODEL_ROUTER_ID);
    expect(offeredModelId('opus-5-5', [])).toBe(MODEL_ROUTER_ID);
  });

  it('keeps no model, and the operator row, as they are', () => {
    expect(offeredModelId(null, offered)).toBeNull();
    expect(offeredModelId(undefined, offered)).toBeNull();
    expect(offeredModelId(MODEL_ROUTER_ID, [])).toBe(MODEL_ROUTER_ID);
  });
});
