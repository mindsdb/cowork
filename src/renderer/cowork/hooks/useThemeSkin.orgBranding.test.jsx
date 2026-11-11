/*
 * useThemeSkin with an org's branding. The order itself is tested
 * in lib/orgBranding.test.ts; this checks the hook applies what it resolves
 * and keeps the member's own choices apart from it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { parseOrgBranding } from '../../lib/orgBranding';
import { useThemeSkin } from './useThemeSkin';

const org = (appearance) => parseOrgBranding({ enabled: true, appearance });

beforeEach(() => {
  localStorage.clear();
  document.body.className = '';
  document.body.removeAttribute('style');
  delete document.body.dataset.theme;
  delete document.body.dataset.skin;
});

describe('useThemeSkin with org branding', () => {
  it("shows the org's look as the default without storing it as the member's", () => {
    const orgBranding = org({ accent: '#112233', defaultTheme: 'light', greeting: 'Welcome' });
    const { result } = renderHook(() => useThemeSkin({ orgBranding, settings: { greeting: '' } }));
    expect(result.current.theme).toBe('light');
    expect(result.current.skin).toBe('custom');
    expect(document.body.dataset.theme).toBe('light');
    expect(document.body.dataset.skin).toBe('custom');
    expect(document.body.style.getPropertyValue('--accent')).toBe('#112233');
    expect(result.current.look.greeting).toBe('Welcome');
    expect(localStorage.getItem('anton.theme')).toBe('dark');
    expect(localStorage.getItem('anton.skin')).toBe('normal');
  });

  it("lets the member's own pick win over the org default, and remembers it was a pick", () => {
    const orgBranding = org({ defaultTheme: 'light', skin: '8bit' });
    const { result } = renderHook(() => useThemeSkin({ orgBranding }));
    act(() => result.current.setTheme('dark'));
    act(() => result.current.setSkin('normal'));
    expect(result.current.theme).toBe('dark');
    expect(result.current.skin).toBe('normal');
    expect(localStorage.getItem('anton.themeChosen')).toBe('1');
    expect(localStorage.getItem('anton.skinChosen')).toBe('1');
  });

  it('toggles from the theme on screen, not the stored one', () => {
    const { result } = renderHook(() => useThemeSkin({ orgBranding: org({ defaultTheme: 'light' }) }));
    act(() => result.current.setTheme((t) => (t === 'dark' ? 'light' : 'dark')));
    expect(result.current.theme).toBe('dark');
  });

  it('ignores picks the org has locked', () => {
    localStorage.setItem('anton.theme', 'dark');
    localStorage.setItem('anton.themeChosen', '1');
    const orgBranding = org({ defaultTheme: 'light', skin: '8bit', membersCanChoose: false });
    const { result } = renderHook(() => useThemeSkin({ orgBranding }));
    expect(result.current.theme).toBe('light');
    act(() => result.current.setTheme('dark'));
    act(() => result.current.setSkin('normal'));
    act(() => result.current.setCustomTheme({ accent: '#ff0000' }));
    expect(result.current.theme).toBe('light');
    expect(result.current.skin).toBe('8bit');
    expect(result.current.look.lockedByOrg).toMatchObject({ style: true, theme: true });
  });

  it("starts the member's own recipe from the org's custom look when they edit it", () => {
    const { result } = renderHook(() => useThemeSkin({ orgBranding: org({ accent: '#112233' }) }));
    expect(result.current.look.skinSource).toBe('org');
    act(() => result.current.setCustomTheme({ ...result.current.customTheme, accent: '#e0c3fc' }));
    expect(result.current.look.skinSource).toBe('member');
    expect(result.current.skin).toBe('custom');
    expect(document.body.style.getPropertyValue('--accent')).toBe('#e0c3fc');
  });

  it('goes back to the stock look when the org has no branding', () => {
    const { result, rerender } = renderHook(({ orgBranding }) => useThemeSkin({ orgBranding }), {
      initialProps: { orgBranding: org({ accent: '#112233' }) },
    });
    rerender({ orgBranding: null });
    expect(result.current.skin).toBe('normal');
    expect(document.body.style.getPropertyValue('--accent')).toBe('');
  });

  it("uses the org's sidebar title in hosted MindsHub and the member's own elsewhere", () => {
    const orgBranding = parseOrgBranding({ enabled: true, sidebarTitle: 'Acme', appearance: {} });
    const settings = { navTitle: 'My space', navTitleColor: '#ff0000' };
    const hosted = renderHook(() => useThemeSkin({ orgBranding, settings, hostedMindsHub: true }));
    expect(hosted.result.current.look).toMatchObject({ navTitle: 'Acme', navTitleColor: null });
    const local = renderHook(() => useThemeSkin({ settings }));
    expect(local.result.current.look).toMatchObject({ navTitle: 'My space', navTitleColor: '#ff0000' });
  });
});
