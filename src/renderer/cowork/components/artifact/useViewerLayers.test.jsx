import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LAYERS_STORAGE_KEY, readLayers, useViewerLayers } from './useViewerLayers';

describe('useViewerLayers', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps Live edit and Comments exclusive: one on turns the other off', () => {
    const { result } = renderHook(() => useViewerLayers());
    act(() => result.current.setLayer('comments', true));
    act(() => result.current.setLayer('source', true));
    expect(result.current.layers).toEqual({ source: true, comments: false });

    act(() => result.current.setLayer('source', false));
    expect(result.current.layers).toEqual({ source: false, comments: false });
  });

  it('opens with Live edit alone when both were saved on', () => {
    window.localStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify({ source: true, comments: true }));
    expect(readLayers()).toEqual({ source: true, comments: false });
  });
});
