import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LAYERS_STORAGE_KEY, readLayers, useViewerLayers } from './useViewerLayers';

describe('useViewerLayers', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps Live edit and Comments exclusive: one on turns the other off', () => {
    const { result } = renderHook(() => useViewerLayers());
    act(() => result.current.setLayer('comments', true));
    act(() => result.current.setLayer('source', true));
    expect(result.current.layers).toEqual({ source: true, comments: false, stats: false });

    act(() => result.current.setLayer('source', false));
    expect(result.current.layers).toEqual({ source: false, comments: false, stats: false });
  });

  it('opens with Live edit alone when both were saved on', () => {
    window.localStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify({ source: true, comments: true }));
    expect(readLayers()).toEqual({ source: true, comments: false, stats: false });
  });

  // ENG-4455: Stats is the third layer, exclusive like the others.
  it('turns Live edit and Comments off when Stats turns on, and back', () => {
    const { result } = renderHook(() => useViewerLayers());
    act(() => result.current.setLayer('comments', true));
    act(() => result.current.setLayer('stats', true));
    expect(result.current.layers).toEqual({ source: false, comments: false, stats: true });

    act(() => result.current.setLayer('source', true));
    expect(result.current.layers).toEqual({ source: true, comments: false, stats: false });
  });

  it('does not remember Stats: the next open starts with it off', () => {
    const { result } = renderHook(() => useViewerLayers());
    act(() => result.current.setLayer('stats', true));

    expect(JSON.parse(window.localStorage.getItem(LAYERS_STORAGE_KEY))).toEqual({ source: false, comments: false });
    window.localStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify({ stats: true }));
    expect(readLayers().stats).toBe(false);
  });

  // ENG-4560: the Artifacts page's comments counter opens the viewer on
  // Comments for that open only.
  it('switches a layer for one open without remembering it, and puts the saved ones back', () => {
    window.localStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify({ source: true, comments: false }));
    const { result } = renderHook(() => useViewerLayers());
    act(() => result.current.setLayer('comments', true, { remember: false }));
    expect(result.current.layers).toEqual({ source: false, comments: true, stats: false });
    expect(JSON.parse(window.localStorage.getItem(LAYERS_STORAGE_KEY))).toEqual({ source: true, comments: false });

    act(() => result.current.restoreLayers());
    expect(result.current.layers).toEqual({ source: true, comments: false, stats: false });
  });

  it('keeps a switch the person makes after one for this open only', () => {
    const { result } = renderHook(() => useViewerLayers());
    act(() => result.current.setLayer('comments', true, { remember: false }));
    act(() => result.current.setLayer('source', true));
    act(() => result.current.restoreLayers());
    expect(result.current.layers).toEqual({ source: true, comments: false, stats: false });
  });
});
