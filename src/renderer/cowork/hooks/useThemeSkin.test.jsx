import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useThemeSkin } from './useThemeSkin';

beforeEach(() => {
  localStorage.clear();
  document.body.className = '';
  delete document.body.dataset.theme;
  delete document.body.dataset.skin;
  delete window.gravityField;
});

describe('useThemeSkin', () => {
  it('defaults to dark and applies the theme to <body> on mount', () => {
    const setTheme = vi.fn();
    window.gravityField = { setTheme };
    const { result } = renderHook(() => useThemeSkin());
    expect(result.current.theme).toBe('dark');
    expect(document.body.dataset.theme).toBe('dark');
    expect(document.body.classList.contains('gf-theme-dark')).toBe(true);
    // the animated background is told to swap palettes live
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('restores a persisted theme', () => {
    localStorage.setItem('anton.theme', 'light');
    const { result } = renderHook(() => useThemeSkin());
    expect(result.current.theme).toBe('light');
    expect(document.body.classList.contains('gf-theme-light')).toBe(true);
  });

  it('setTheme swaps the body classes, sets data-theme, and persists', () => {
    const { result } = renderHook(() => useThemeSkin());
    act(() => result.current.setTheme('light'));
    expect(document.body.dataset.theme).toBe('light');
    expect(document.body.classList.contains('gf-theme-light')).toBe(true);
    expect(document.body.classList.contains('gf-theme-dark')).toBe(false);
    expect(localStorage.getItem('anton.theme')).toBe('light');
  });

  it('mirrors the skin to body[data-skin]', () => {
    const { result } = renderHook(() => useThemeSkin());
    expect(document.body.dataset.skin).toBe(result.current.skin);
    act(() => result.current.setSkin('8bit'));
    expect(document.body.dataset.skin).toBe('8bit');
  });

  it('toggles the Display picker modal open state', () => {
    const { result } = renderHook(() => useThemeSkin());
    expect(result.current.themeModalOpen).toBe(false);
    act(() => result.current.setThemeModalOpen(true));
    expect(result.current.themeModalOpen).toBe(true);
  });

  it('exposes and updates the custom-theme recipe', () => {
    const { result } = renderHook(() => useThemeSkin());
    act(() => result.current.setCustomTheme({ accent: '#123456' }));
    expect(result.current.customTheme).toEqual({ accent: '#123456' });
  });
});
