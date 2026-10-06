import { describe, it, expect } from 'vitest';
import { displayToggleMode, nextToggledSkin } from './displayToggle';

describe('displayToggleMode', () => {
  it('opens the menu when both switches are on (the default)', () => {
    expect(displayToggleMode({})).toBe('menu');
    expect(displayToggleMode({ showThemeToggle: true, show8bitToggle: true })).toBe('menu');
  });

  it('flips only the theme when the 8-bit switch is off', () => {
    expect(displayToggleMode({ showThemeToggle: true, show8bitToggle: false })).toBe('theme');
  });

  // The reported bug: turning the theme switch off still left a theme control.
  it('flips only the style when the theme switch is off', () => {
    expect(displayToggleMode({ showThemeToggle: false, show8bitToggle: true })).toBe('style');
  });

  it('shows no button when both switches are off', () => {
    expect(displayToggleMode({ showThemeToggle: false, show8bitToggle: false })).toBeNull();
  });
});

describe('nextToggledSkin', () => {
  it('toggles between Normal and 8-Bit, treating Custom as not 8-Bit', () => {
    expect(nextToggledSkin('normal')).toBe('8bit');
    expect(nextToggledSkin('8bit')).toBe('normal');
    expect(nextToggledSkin('custom')).toBe('8bit');
  });
});
