/*
 * A deployment brand that locks the style: the corner and top-bar buttons keep
 * only the theme control. displayToggle.test.js covers the unlocked switches.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/deploymentBrand', () => {
  const brand = {
    productName: null, skin: null, theme: null, logoUrl: null, iconUrl: null, appleTouchIconUrl: null, skinLocked: true,
  };
  return { BRAND_LOAD: { status: 'loaded', brand, dropped: [] }, DEPLOYMENT_BRAND: brand };
});

import { displayToggleMode } from './displayToggle';

describe('the display button under a style lock', () => {
  it('flips only the theme, whatever the 8-bit switch says', () => {
    expect(displayToggleMode({})).toBe('theme');
    expect(displayToggleMode({ showThemeToggle: true, show8bitToggle: true })).toBe('theme');
  });

  it('shows no button when the theme switch is off', () => {
    expect(displayToggleMode({ showThemeToggle: false, show8bitToggle: true })).toBeNull();
  });
});
