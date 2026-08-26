import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  engines: vi.fn(),
  models: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return { ...original, codingApi: api };
});

import { useCodingCatalog } from './useCodingCatalog';

describe('useCodingCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.engines.mockResolvedValue([{
      id: 'codex',
      label: 'Codex',
      adapter_version: '1',
      available: true,
      supports_models: true,
    }]);
    api.models.mockResolvedValue({ items: ['gpt-5.6-sol'] });
  });

  it('deduplicates concurrent catalogue requests for the same agent', async () => {
    const { result } = renderHook(() => useCodingCatalog());

    await waitFor(() => expect(result.current.enginesLoading).toBe(false));
    await act(async () => {
      await Promise.all([
        result.current.loadModels('codex'),
        result.current.loadModels('codex'),
      ]);
    });

    expect(api.engines).toHaveBeenCalledTimes(1);
    expect(api.models).toHaveBeenCalledTimes(1);
    expect(result.current.modelIds('codex')).toEqual(['gpt-5.6-sol']);
  });

  it('allows a transient model failure to be retried', async () => {
    api.models.mockRejectedValueOnce(new Error('Catalogue unavailable'));
    const { result } = renderHook(() => useCodingCatalog());

    await waitFor(() => expect(result.current.enginesLoading).toBe(false));
    await act(async () => { await result.current.loadModels('codex'); });
    expect(result.current.modelError('codex')).toBe('Catalogue unavailable');

    await act(async () => { await result.current.loadModels('codex'); });

    expect(api.models).toHaveBeenCalledTimes(2);
    expect(result.current.modelError('codex')).toBe('');
    expect(result.current.modelIds('codex')).toEqual(['gpt-5.6-sol']);
  });
});
