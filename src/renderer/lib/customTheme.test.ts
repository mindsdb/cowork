import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_CUSTOM_THEME, loadCustomTheme, persistCustomTheme, applyNavTitleColor } from './customTheme';

describe('customTheme — nav title fields', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.removeAttribute('style');
  });

  it('defaults navTitle/navTitleColor to null', () => {
    expect(DEFAULT_CUSTOM_THEME.navTitle).toBeNull();
    expect(DEFAULT_CUSTOM_THEME.navTitleColor).toBeNull();
    expect(loadCustomTheme()).toEqual(DEFAULT_CUSTOM_THEME);
  });

  it('round-trips navTitle/navTitleColor through persist + load', () => {
    persistCustomTheme({ ...DEFAULT_CUSTOM_THEME, navTitle: 'Acme', navTitleColor: '#ff0000' });
    const loaded = loadCustomTheme();
    expect(loaded.navTitle).toBe('Acme');
    expect(loaded.navTitleColor).toBe('#ff0000');
  });

  it('discards a blank/whitespace navTitle back to null on load', () => {
    window.localStorage.setItem('anton.customTheme', JSON.stringify({ ...DEFAULT_CUSTOM_THEME, navTitle: '   ' }));
    expect(loadCustomTheme().navTitle).toBeNull();
  });

  it('applyNavTitleColor sets --nav-title-color as an inline body property', () => {
    applyNavTitleColor('#00ff00');
    expect(document.body.style.getPropertyValue('--nav-title-color')).toBe('#00ff00');
  });

  it('applyNavTitleColor(null) clears the property, falling back to the theme default', () => {
    applyNavTitleColor('#00ff00');
    applyNavTitleColor(null);
    expect(document.body.style.getPropertyValue('--nav-title-color')).toBe('');
  });
});

describe('customTheme — logo + floating-toggle visibility fields', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults navLogo to null and both toggles to visible', () => {
    expect(DEFAULT_CUSTOM_THEME.navLogo).toBeNull();
    expect(DEFAULT_CUSTOM_THEME.showThemeToggle).toBe(true);
    expect(DEFAULT_CUSTOM_THEME.show8bitToggle).toBe(true);
    expect(loadCustomTheme()).toEqual(DEFAULT_CUSTOM_THEME);
  });

  it('round-trips navLogo and both toggle flags through persist + load', () => {
    persistCustomTheme({
      ...DEFAULT_CUSTOM_THEME,
      navLogo: 'data:image/png;base64,abc123',
      showThemeToggle: false,
      show8bitToggle: false,
    });
    const loaded = loadCustomTheme();
    expect(loaded.navLogo).toBe('data:image/png;base64,abc123');
    expect(loaded.showThemeToggle).toBe(false);
    expect(loaded.show8bitToggle).toBe(false);
  });

  it('discards a blank navLogo back to null on load', () => {
    window.localStorage.setItem('anton.customTheme', JSON.stringify({ ...DEFAULT_CUSTOM_THEME, navLogo: '   ' }));
    expect(loadCustomTheme().navLogo).toBeNull();
  });

  it('falls back both toggle flags to true when stored value is not a boolean', () => {
    window.localStorage.setItem('anton.customTheme', JSON.stringify({ ...DEFAULT_CUSTOM_THEME, showThemeToggle: 'nope', show8bitToggle: undefined }));
    const loaded = loadCustomTheme();
    expect(loaded.showThemeToggle).toBe(true);
    expect(loaded.show8bitToggle).toBe(true);
  });
});
