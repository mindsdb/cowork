import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePresence } from './usePresence';

describe('usePresence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays mounted and leaving for the exit, then unmounts', () => {
    const { result, rerender } = renderHook(({ show }) => usePresence(show, 160), { initialProps: { show: true } });
    expect(result.current).toEqual({ mounted: true, leaving: false });

    rerender({ show: false });
    expect(result.current).toEqual({ mounted: true, leaving: true });

    act(() => { vi.advanceTimersByTime(160); });
    expect(result.current).toEqual({ mounted: false, leaving: false });
  });

  it('comes straight back when shown again mid-exit', () => {
    const { result, rerender } = renderHook(({ show }) => usePresence(show, 160), { initialProps: { show: true } });
    rerender({ show: false });
    rerender({ show: true });
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toEqual({ mounted: true, leaving: false });
  });
});
