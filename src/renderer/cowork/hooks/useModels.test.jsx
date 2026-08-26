import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useModels } from './useModels';
import { MODEL_ROUTER } from '../lib/modelCatalog';
import { recommendedModelOptions, providerValueToType, mergeRecommendedModels } from '../lib/settingsTransform';
import { fetchRecommendedModels } from '../api';

vi.mock('../lib/settingsTransform', () => ({
  recommendedModelOptions: vi.fn(() => []),
  providerValueToType: vi.fn(() => 'minds-cloud'),
  mergeRecommendedModels: vi.fn(() => null),
}));

vi.mock('../api', () => ({
  fetchRecommendedModels: vi.fn(async () => ({})),
}));

const baseSettings = {
  planningProvider: 'minds-cloud',
  recommendedModels: {},
  modelLabels: {},
  modelProviders: { a: 'minds-cloud' },
  modelFamilies: { a: 'gpt' },
  modelEnabled: { a: true },
};

const render = (settings = baseSettings, setSettings = vi.fn()) =>
  renderHook(({ s, set }) => useModels({ settings: s, setSettings: set }), {
    initialProps: { s: settings, set: setSettings },
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useModels', () => {
  it('defaults selectedModel to MODEL_ROUTER', () => {
    const { result } = render();
    expect(result.current.selectedModel).toBe(MODEL_ROUTER);
  });

  it('setSelectedModel replaces the selection', () => {
    const { result } = render();
    const pick = { id: 'gpt-5', name: 'GPT-5' };
    act(() => result.current.setSelectedModel(pick));
    expect(result.current.selectedModel).toBe(pick);
  });

  it('derives models from recommendedModelOptions for the planning provider', () => {
    providerValueToType.mockReturnValue('minds-cloud');
    recommendedModelOptions.mockReturnValue([
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ]);
    const { result } = render();
    expect(providerValueToType).toHaveBeenCalledWith(baseSettings.planningProvider);
    expect(recommendedModelOptions).toHaveBeenCalledWith(
      baseSettings.recommendedModels,
      'minds-cloud',
      baseSettings.modelLabels,
    );
    expect(result.current.models).toEqual([
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ]);
  });

  it('falls back to minds-cloud when the provider type is unknown', () => {
    providerValueToType.mockReturnValue(null);
    render();
    expect(recommendedModelOptions).toHaveBeenCalledWith(expect.anything(), 'minds-cloud', expect.anything());
  });

  it('modelMeta exposes the provider/family/enabled maps and wires onRefresh', () => {
    const { result } = render();
    expect(result.current.modelMeta.modelProviders).toBe(baseSettings.modelProviders);
    expect(result.current.modelMeta.modelFamilies).toBe(baseSettings.modelFamilies);
    expect(result.current.modelMeta.modelEnabled).toBe(baseSettings.modelEnabled);
    expect(result.current.modelMeta.onRefresh).toBe(result.current.refreshModelAvailability);
  });

  it('refreshModelAvailability merges a fresh fetch into settings', async () => {
    fetchRecommendedModels.mockResolvedValue({ recommendedModels: { x: 1 } });
    mergeRecommendedModels.mockReturnValue({ recommendedModels: { x: 1 } });
    const setSettings = vi.fn();
    const { result } = render(baseSettings, setSettings);

    await act(async () => { await result.current.refreshModelAvailability(); });

    expect(fetchRecommendedModels).toHaveBeenCalledWith({ refresh: true });
    expect(mergeRecommendedModels).toHaveBeenCalledWith(baseSettings, { recommendedModels: { x: 1 } });
    expect(setSettings).toHaveBeenCalledTimes(1);
    // Merges onto prior state rather than replacing it.
    const updater = setSettings.mock.calls[0][0];
    expect(updater({ keep: true })).toEqual({ keep: true, recommendedModels: { x: 1 } });
  });

  it('refreshModelAvailability leaves settings untouched when the merge is a no-op', async () => {
    fetchRecommendedModels.mockResolvedValue({});
    mergeRecommendedModels.mockReturnValue(null);
    const setSettings = vi.fn();
    const { result } = render(baseSettings, setSettings);

    await act(async () => { await result.current.refreshModelAvailability(); });

    expect(setSettings).not.toHaveBeenCalled();
  });
});
