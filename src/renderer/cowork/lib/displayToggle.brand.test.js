// Leaving 8-Bit from the corner toggle returns to the default style, which is
// a deployment brand's style when it has one. displayToggle.test.js covers the
// stock list.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/deploymentBrand', () => {
  const brand = {
    productName: null, skin: { id: 'acme', label: 'Acme' }, theme: null, logoUrl: null, iconUrl: null, appleTouchIconUrl: null, skinLocked: null,
  };
  return { BRAND_LOAD: { status: 'loaded', brand, dropped: [] }, DEPLOYMENT_BRAND: brand };
});

import { nextToggledSkin, styleToggleLabel } from './displayToggle';

describe('the corner style toggle with a deployment brand', () => {
  it("returns from 8-Bit to the brand's style", () => {
    expect(nextToggledSkin('8bit')).toBe('acme');
    expect(styleToggleLabel('8bit')).toBe('Switch to Acme style');
    expect(nextToggledSkin('acme')).toBe('8bit');
    expect(styleToggleLabel('acme')).toBe('Switch to 8-Bit style');
  });
});
