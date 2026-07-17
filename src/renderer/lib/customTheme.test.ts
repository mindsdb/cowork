import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_CUSTOM_THEME, loadCustomTheme, persistCustomTheme, applyCustomTheme } from './customTheme';

const STORAGE_KEY = 'anton.customTheme';

describe('customTheme — light/dark background split', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.removeAttribute('style');
    document.body.className = '';
  });

  it('defaults bgLight/bgDark to null', () => {
    expect(DEFAULT_CUSTOM_THEME.bgLight).toBeNull();
    expect(DEFAULT_CUSTOM_THEME.bgDark).toBeNull();
    expect(loadCustomTheme()).toEqual(DEFAULT_CUSTOM_THEME);
  });

  it('migrates a legacy single `bg` field into both bgLight and bgDark', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_CUSTOM_THEME, bg: '#123456' }));
    const loaded = loadCustomTheme();
    expect(loaded.bgLight).toBe('#123456');
    expect(loaded.bgDark).toBe('#123456');
  });

  it('round-trips distinct bgLight/bgDark values through persist + load', () => {
    persistCustomTheme({ ...DEFAULT_CUSTOM_THEME, bgLight: '#fafafa', bgDark: '#080d18' });
    const loaded = loadCustomTheme();
    expect(loaded.bgLight).toBe('#fafafa');
    expect(loaded.bgDark).toBe('#080d18');
  });

  it('applies bgLight when theme is light and bgDark when theme is dark', () => {
    const t = { ...DEFAULT_CUSTOM_THEME, bgLight: '#ffffff', bgDark: '#000000' };

    applyCustomTheme(t, 'light');
    expect(document.body.style.getPropertyValue('--bg')).toBe('#ffffff');

    applyCustomTheme(t, 'dark');
    expect(document.body.style.getPropertyValue('--bg')).toBe('#000000');
  });

  it('marks custom-bg-active on body only while a resolved background is set', () => {
    const withBg = { ...DEFAULT_CUSTOM_THEME, bgDark: '#000000' };
    applyCustomTheme(withBg, 'dark');
    expect(document.body.classList.contains('custom-bg-active')).toBe(true);

    // Same recipe, but Light mode has no override — nothing to flatten there.
    applyCustomTheme(withBg, 'light');
    expect(document.body.classList.contains('custom-bg-active')).toBe(false);
  });

  it('clears custom-bg-active when the theme is turned off entirely (t = null)', () => {
    applyCustomTheme({ ...DEFAULT_CUSTOM_THEME, bgDark: '#000000' }, 'dark');
    expect(document.body.classList.contains('custom-bg-active')).toBe(true);
    applyCustomTheme(null, 'dark');
    expect(document.body.classList.contains('custom-bg-active')).toBe(false);
  });

  // The window-level background (outside the sidebar) is otherwise hardcoded
  // per stock theme by .gf-theme-light/.gf-theme-dark (styles.css), which
  // never reference --bg — so without an inline override here, a custom
  // background would only ever show up inside the sidebar.
  describe('window-level background (outside the sidebar)', () => {
    it('sets an inline body background darker than the picked color', () => {
      applyCustomTheme({ ...DEFAULT_CUSTOM_THEME, bgDark: '#334455' }, 'dark');
      const applied = document.body.style.getPropertyValue('background');
      expect(applied).not.toBe('');
      expect(applied.toLowerCase()).not.toBe('#334455');
    });

    it('clears the inline background when no custom bg is resolved', () => {
      applyCustomTheme({ ...DEFAULT_CUSTOM_THEME, bgDark: '#334455' }, 'light');
      expect(document.body.style.getPropertyValue('background')).toBe('');
    });

    it('clears the inline background when the theme is turned off (t = null)', () => {
      applyCustomTheme({ ...DEFAULT_CUSTOM_THEME, bgDark: '#334455' }, 'dark');
      expect(document.body.style.getPropertyValue('background')).not.toBe('');
      applyCustomTheme(null, 'dark');
      expect(document.body.style.getPropertyValue('background')).toBe('');
    });
  });
});
