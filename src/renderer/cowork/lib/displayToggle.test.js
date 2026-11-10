import { describe, it, expect } from 'vitest';
import { displayToggleMode, nextToggledSkin, styleToggleLabel } from './displayToggle';

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

describe('displayToggleMode under an org that turned member choice off', () => {
  it('hides the button when the org sets both theme and style', () => {
    expect(displayToggleMode({}, { theme: true, style: true })).toBeNull();
  });

  it('opens the menu with only the style when the org sets the theme', () => {
    expect(displayToggleMode({}, { theme: true, style: false })).toBe('menu');
  });

  it('opens the menu with only the theme when the org sets the style', () => {
    expect(displayToggleMode({}, { theme: false, style: true })).toBe('menu');
  });

  it('is unchanged when the org sets neither', () => {
    expect(displayToggleMode({}, { theme: false, style: false })).toBe('menu');
    expect(displayToggleMode({ show8bitToggle: false }, { theme: false, style: false })).toBe('theme');
  });

  it("still respects the person's own switches", () => {
    expect(displayToggleMode({ show8bitToggle: false }, { theme: true, style: false })).toBeNull();
    expect(displayToggleMode({ showThemeToggle: false }, { theme: true, style: false })).toBe('style');
    expect(displayToggleMode({ show8bitToggle: false }, { theme: false, style: true })).toBe('theme');
  });
});

describe('nextToggledSkin', () => {
  it('toggles between Normal and 8-Bit, treating Custom as not 8-Bit', () => {
    expect(nextToggledSkin('normal')).toBe('8bit');
    expect(nextToggledSkin('8bit')).toBe('normal');
    expect(nextToggledSkin('custom')).toBe('8bit');
  });

  it('names the style it switches to', () => {
    expect(styleToggleLabel('normal')).toBe('Switch to 8-Bit style');
    expect(styleToggleLabel('8bit')).toBe('Switch to Normal style');
  });
});
