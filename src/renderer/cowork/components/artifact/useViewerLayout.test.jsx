import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY, readLayout, useViewerLayout } from './useViewerLayout';

describe('useViewerLayout', () => {
  beforeEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });

  it('starts at the defaults: full screen', () => {
    const { result } = renderHook(() => useViewerLayout());
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
    expect(result.current.layout.maximized).toBe(true);
  });

  it('starts full screen whatever was saved under the old normal-size default', () => {
    window.localStorage.setItem('cowork.artifactViewer.layout.v1', JSON.stringify({ maximized: false }));
    expect(readLayout().maximized).toBe(true);
  });

  it('toggles and remembers each setting, per person', () => {
    const { result } = renderHook(() => useViewerLayout('u1'));
    act(() => result.current.toggle('maximized'));
    expect(result.current.layout.maximized).toBe(false);
    expect(readLayout('u1').maximized).toBe(false);
    expect(readLayout('u2').maximized).toBe(true);
  });

  it('ignores unknown names, malformed values and the old hide choices', () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ maximized: 'yes', toolbarHidden: true, extra: 1 }));
    const { result } = renderHook(() => useViewerLayout());
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
    act(() => result.current.toggle('toolbarHidden'));
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
  });

  it('keeps every mounted viewer on the same choice', () => {
    const first = renderHook(() => useViewerLayout());
    const second = renderHook(() => useViewerLayout());
    act(() => first.result.current.toggle('maximized'));
    expect(second.result.current.layout.maximized).toBe(false);
    act(() => second.result.current.toggle('maximized'));
    expect(first.result.current.layout.maximized).toBe(true);
  });

  it('still toggles when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useViewerLayout('blocked'));
    const other = renderHook(() => useViewerLayout('blocked'));
    act(() => result.current.toggle('maximized'));
    expect(result.current.layout.maximized).toBe(false);
    expect(other.result.current.layout.maximized).toBe(false);
  });
});
