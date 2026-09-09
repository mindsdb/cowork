import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  engines: vi.fn(),
  models: vi.fn(),
}));
const credentialListeners = vi.hoisted(() => new Set<() => void>());
vi.mock('../../platform/host', () => ({
  onMindsHubCredentialChanged: (listener: () => void) => {
    credentialListeners.add(listener);
    return () => credentialListeners.delete(listener);
  },
}));

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return { ...original, codingApi: api };
});

import { useCodingCatalog } from './useCodingCatalog';

function useConsumer(enabled = true) {
  const catalog = useCodingCatalog(enabled);
  useEffect(() => { void catalog.loadModels('codex'); }, [catalog.loadModels, catalog.revision]);
  return catalog;
}

function credentialChanged() {
  act(() => credentialListeners.forEach((listener) => listener()));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('useCodingCatalog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    credentialListeners.clear();
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

  it('recovers both failed catalogues after sign-in without remounting', async () => {
    api.engines.mockRejectedValueOnce(new Error('Sign in'));
    api.models.mockRejectedValueOnce(new Error('No credential'));
    const { result } = renderHook(() => useConsumer());
    await waitFor(() => expect(result.current.modelError('codex')).toBe('No credential'));
    expect(result.current.error).toBe('Sign in');
    const loadModels = result.current.loadModels;
    expect(result.current.revision).toBe(0);

    credentialChanged();
    await waitFor(() => expect(result.current.modelIds('codex')).toEqual(['gpt-5.6-sol']));
    expect(result.current.revision).toBe(1);
    expect(result.current.loadModels).toBe(loadModels);
    expect(result.current.engines[0].available).toBe(true);
    expect(result.current.error).toBe('');
    expect(result.current.modelError('codex')).toBe('');
    expect(api.engines).toHaveBeenCalledTimes(2);
    expect(api.models).toHaveBeenCalledTimes(2);
  });

  it('drops cached access on sign-out and reloads for a replacement API key', async () => {
    const { result } = renderHook(() => useConsumer());
    await waitFor(() => expect(result.current.modelIds('codex')).toEqual(['gpt-5.6-sol']));
    api.engines.mockResolvedValueOnce([{ id: 'codex', available: false }]);
    api.models.mockRejectedValueOnce(new Error('Sign in to use coding models'));
    credentialChanged();
    expect(result.current.modelIds('codex')).toBeNull();
    await waitFor(() => expect(result.current.modelError('codex')).toContain('Sign in'));
    expect(result.current.engines[0].available).toBe(false);
    expect(result.current.modelIds('codex')).toEqual([]);

    api.models.mockResolvedValueOnce({ items: ['replacement-model'] });
    credentialChanged();
    await waitFor(() => expect(result.current.modelIds('codex')).toEqual(['replacement-model']));
    expect(result.current.engines[0].available).toBe(true);
    expect(result.current.modelError('codex')).toBe('');
  });

  it.each(['success', 'failure'] as const)('ignores an old session’s late %s without releasing the new request', async (outcome) => {
    const oldEngines = deferred<unknown[]>();
    const oldModels = deferred<{ items: string[] }>();
    const freshEngines = deferred<unknown[]>();
    const freshModels = deferred<{ items: string[] }>();
    api.engines.mockReturnValueOnce(oldEngines.promise).mockReturnValueOnce(freshEngines.promise);
    api.models.mockReturnValueOnce(oldModels.promise).mockReturnValueOnce(freshModels.promise);
    const { result } = renderHook(() => useConsumer());
    credentialChanged();
    await act(async () => {
      if (outcome === 'success') {
        oldEngines.resolve([{ id: 'old', available: true }]);
        oldModels.resolve({ items: ['old-model'] });
      } else {
        oldEngines.reject(new Error('Old error'));
        oldModels.reject(new Error('Old error'));
      }
    });
    expect(result.current.engines).toEqual([]);
    expect(result.current.enginesLoading).toBe(true);
    expect(result.current.modelIds('codex')).toBeNull();
    expect(result.current.modelsLoading('codex')).toBe(true);
    expect(result.current.error).toBe('');
    expect(result.current.modelError('codex')).toBe('');
    let deduplicated!: Promise<void>;
    act(() => { deduplicated = result.current.loadModels('codex'); });
    expect(api.models).toHaveBeenCalledTimes(2);
    await act(async () => {
      freshEngines.resolve([{ id: 'codex', available: false }]);
      freshModels.resolve({ items: [] });
      await deduplicated;
    });
    expect(result.current.modelsLoading('codex')).toBe(false);
    expect(result.current.engines[0].available).toBe(false);
    expect(result.current.modelIds('codex')).toEqual([]);
  });

  it('does not subscribe or fetch when disabled and cleans up subscriptions', async () => {
    const { result, rerender, unmount } = renderHook(({ enabled }) => useConsumer(enabled), {
      initialProps: { enabled: false },
    });
    expect(credentialListeners.size).toBe(0);
    expect(api.engines).not.toHaveBeenCalled();
    expect(api.models).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.modelIds('codex')).toEqual(['gpt-5.6-sol']));
    expect(credentialListeners.size).toBe(1);
    rerender({ enabled: false });
    expect(result.current.engines).toEqual([]);
    expect(result.current.modelIds('codex')).toBeNull();
    expect(credentialListeners.size).toBe(0);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.modelIds('codex')).toEqual(['gpt-5.6-sol']));
    expect(api.models).toHaveBeenCalledTimes(2);
    unmount();
    expect(credentialListeners.size).toBe(0);
  });

  it('settles after Strict Mode effect replay', async () => {
    const { result } = renderHook(() => useConsumer(), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.modelIds('codex')).toEqual(['gpt-5.6-sol']));
    expect(result.current.enginesLoading).toBe(false);
    expect(result.current.modelsLoading('codex')).toBe(false);
    expect(credentialListeners.size).toBe(1);
    credentialChanged();
    await waitFor(() => expect(result.current.modelIds('codex')).toEqual(['gpt-5.6-sol']));
  });
});
