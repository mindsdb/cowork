import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSidebarNav } from './useSidebarNav';

const render = (props) =>
  renderHook((p) => useSidebarNav(p), {
    initialProps: { isNarrow: false, ...props },
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
    expect(result.current.sidebarCollapsibleRoutes.has('code')).toBe(true);
    expect(result.current.sidebarCollapsibleRoutes.has('home')).toBe(false);
  });

  it('sidebarPopout is true in the narrow band', () => {
    const { result } = render({ isNarrow: true });
    expect(result.current.sidebarPopout).toBe(true);
  });

  it('sidebarPopout stays false on a wide desktop', () => {
    const { result } = render({ isNarrow: false });
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
