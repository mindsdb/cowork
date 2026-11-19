// Display settings under a deployment brand's style lock offer the theme alone.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../lib/deploymentBrand', () => {
  const brand = {
    productName: null, skin: null, theme: null, logoUrl: null, iconUrl: null, appleTouchIconUrl: null, skinLocked: true,
  };
  return { BRAND_LOAD: { status: 'loaded', brand, dropped: [] }, DEPLOYMENT_BRAND: brand };
});

import ThemeModal from './ThemeModal';

describe('ThemeModal under a style lock', () => {
  it('offers the theme without the style', () => {
    render(<ThemeModal open onClose={vi.fn()} theme="dark" onThemeChange={vi.fn()} skin="normal" onSkinChange={vi.fn()} />);
    expect(screen.getByText('Theme — applied live')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument();
    expect(screen.queryByText('Style')).toBeNull();
    expect(screen.queryByRole('button', { name: '8-Bit' })).toBeNull();
  });
});
