import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBreakpoint } from './useBreakpoint';
import { BROWSER_PANE_INLINE_MIN, BROWSER_PANE_INLINE_MIN_CSS } from '../lib/breakpoints';

// Thresholds in the hook: mobile < 640, narrow < 900, browser pane floats < 1160.
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
    expect(result.current).toEqual({ isMobile: false, isNarrow: false, paneFloats: false });

    setWidth(1024); // < 1160, ≥ 900
    expect(result.current).toEqual({ isMobile: false, isNarrow: false, paneFloats: true });

    setWidth(800); // < 900, ≥ 640
    expect(result.current).toEqual({ isMobile: false, isNarrow: true, paneFloats: true });

    setWidth(500); // < 640 → all three
    expect(result.current).toEqual({ isMobile: true, isNarrow: true, paneFloats: true });
  });

  it('floats the browser pane below the same width the pane\'s CSS does', () => {
    const { result } = renderHook(() => useBreakpoint());

    setWidth(BROWSER_PANE_INLINE_MIN - 1);
    expect(result.current.paneFloats).toBe(true);
    setWidth(BROWSER_PANE_INLINE_MIN);
    expect(result.current.paneFloats).toBe(false);

    const css = readFileSync(join(__dirname, '../components/browser/browser-panel.css'), 'utf8');
    expect(css).toContain(`@media (max-width: ${BROWSER_PANE_INLINE_MIN_CSS}px)`);
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
