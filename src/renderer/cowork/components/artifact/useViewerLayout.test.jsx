import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY, readLayout, useViewerLayout } from './useViewerLayout';

describe('useViewerLayout', () => {
  beforeEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });

  it('starts at the defaults: normal size, everything shown', () => {
    const { result } = renderHook(() => useViewerLayout());
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
  });

  it('toggles and remembers each setting, per person', () => {
    const { result } = renderHook(() => useViewerLayout('u1'));
    act(() => result.current.toggle('maximized'));
    expect(result.current.layout.maximized).toBe(true);
    expect(readLayout('u1').maximized).toBe(true);
    expect(readLayout('u2').maximized).toBe(false);
  });

  it('ignores unknown names and malformed saved values', () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ maximized: 'yes', toolbarHidden: true, extra: 1 }));
    const { result } = renderHook(() => useViewerLayout());
    expect(result.current.layout).toEqual({ ...DEFAULT_LAYOUT, toolbarHidden: true });
    act(() => result.current.toggle('nope'));
    expect(result.current.layout).toEqual({ ...DEFAULT_LAYOUT, toolbarHidden: true });
  });

  it('still toggles when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useViewerLayout());
    act(() => result.current.toggle('quickEditHidden'));
    expect(result.current.layout.quickEditHidden).toBe(true);
  });
});
