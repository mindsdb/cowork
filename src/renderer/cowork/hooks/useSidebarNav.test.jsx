import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSidebarNav } from './useSidebarNav';
import { host } from '../../platform/host';

const render = (props) =>
  renderHook((p) => useSidebarNav(p), {
    initialProps: { isNarrow: false, isMobile: false, codingModeActive: false, ...props },
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSidebarNav', () => {
  it('defaults collapsed=false, popout closed', () => {
    const { result } = render();
    expect(result.current.sidebarCollapsed).toBe(false);
    expect(result.current.navPopoutOpen).toBe(false);
    expect(result.current.sidebarCollapsibleRoutes.has('task')).toBe(true);
    expect(result.current.sidebarCollapsibleRoutes.has('home')).toBe(false);
  });

  it('sidebarPopout is true in the narrow band', () => {
    const { result } = render({ isNarrow: true });
    expect(result.current.sidebarPopout).toBe(true);
  });

  it('sidebarPopout is true for desktop coding mode (not web, not mobile)', () => {
    vi.spyOn(host, 'isWeb', 'get').mockReturnValue(false);
    const { result } = render({ isNarrow: false, isMobile: false, codingModeActive: true });
    expect(result.current.sidebarPopout).toBe(true);
  });

  it('sidebarPopout is false for coding mode on web', () => {
    vi.spyOn(host, 'isWeb', 'get').mockReturnValue(true);
    const { result } = render({ isNarrow: false, isMobile: false, codingModeActive: true });
    expect(result.current.sidebarPopout).toBe(false);
  });

  it('sidebarPopout is false for coding mode on true mobile', () => {
    const { result } = render({ isNarrow: false, isMobile: true, codingModeActive: true });
    expect(result.current.sidebarPopout).toBe(false);
  });

  it('Escape closes the popout only while it is open', () => {
    const { result } = render();
    act(() => result.current.setNavPopoutOpen(true));
    expect(result.current.navPopoutOpen).toBe(true);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(result.current.navPopoutOpen).toBe(false);
  });

  it('does not listen for Escape when the popout is closed', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    render();
    expect(addSpy.mock.calls.some(([type]) => type === 'keydown')).toBe(false);
  });
});
