/*
 * A deployment brand that locks the style, through the real skins module.
 * useThemeSkin.test.jsx covers the unlocked hook.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../../lib/deploymentBrand', () => {
  const brand = {
    productName: null, skin: null, theme: null, logoUrl: null, iconUrl: null, appleTouchIconUrl: null, skinLocked: true,
  };
  return { BRAND_LOAD: { status: 'loaded', brand, dropped: [] }, DEPLOYMENT_BRAND: brand };
});

import { useThemeSkin } from './useThemeSkin';

beforeEach(() => {
  localStorage.clear();
  document.body.className = '';
  delete document.body.dataset.theme;
  delete document.body.dataset.skin;
});

describe('useThemeSkin under a style lock', () => {
  it('keeps body[data-skin] on the locked style and the saved style untouched', () => {
    localStorage.setItem('anton.skin', '8bit');
    const { result } = renderHook(() => useThemeSkin());
    expect(result.current.skin).toBe('normal');
    expect(document.body.dataset.skin).toBe('normal');
    act(() => result.current.setSkin('custom'));
    expect(result.current.skin).toBe('normal');
    expect(document.body.dataset.skin).toBe('normal');
    expect(localStorage.getItem('anton.skin')).toBe('8bit');
  });

  it('still lets the theme change', () => {
    const { result } = renderHook(() => useThemeSkin());
    act(() => result.current.setTheme('light'));
    expect(document.body.dataset.theme).toBe('light');
    expect(localStorage.getItem('anton.theme')).toBe('light');
  });
});
