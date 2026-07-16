import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBreakpoint } from './useBreakpoint';

// Thresholds in the hook: mobile < 640, narrow < 900.
function setWidth(px) {
  window.happyDOM.setViewport({ width: px });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

describe('useBreakpoint', () => {
  it('classifies desktop / narrow / mobile widths', () => {
    const { result } = renderHook(() => useBreakpoint());

    setWidth(1200);
    expect(result.current).toEqual({ isMobile: false, isNarrow: false });

    setWidth(800); // < 900, ≥ 640
    expect(result.current).toEqual({ isMobile: false, isNarrow: true });

    setWidth(500); // < 640 → both
    expect(result.current).toEqual({ isMobile: true, isNarrow: true });
  });

  it('treats the exact thresholds as NOT below the breakpoint', () => {
    const { result } = renderHook(() => useBreakpoint());

    setWidth(640);
    expect(result.current.isMobile).toBe(false);
    setWidth(900);
    expect(result.current.isNarrow).toBe(false);
  });

  it('responds to resize events after mount', () => {
    setWidth(1200);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.isMobile).toBe(false);

    setWidth(400);
    expect(result.current.isMobile).toBe(true);
  });
});
