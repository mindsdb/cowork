import { describe, it, expect, beforeEach } from 'vitest';
import { applyNavTitleColor } from './navBranding';

describe('navBranding — applyNavTitleColor', () => {
  beforeEach(() => {
    document.body.removeAttribute('style');
  });

  it('sets --nav-title-color as an inline body property', () => {
    applyNavTitleColor('#00ff00');
    expect(document.body.style.getPropertyValue('--nav-title-color')).toBe('#00ff00');
  });

  it('clears the property for a null/empty color, falling back to the theme default', () => {
    applyNavTitleColor('#00ff00');
    applyNavTitleColor(null);
    expect(document.body.style.getPropertyValue('--nav-title-color')).toBe('');

    applyNavTitleColor('#00ff00');
    applyNavTitleColor('');
    expect(document.body.style.getPropertyValue('--nav-title-color')).toBe('');
  });
});
