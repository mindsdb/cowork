import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProviderIcon } from './ProviderIcon';

// happy-dom (this project's renderer test environment) doesn't implement
// real SVG layout, so SVGGraphicsElement.getBBox() isn't available here —
// ProviderIcon feature-detects that and falls back to each mark's nominal
// viewBox. These tests exercise that fallback path; the real Electron
// (Chromium) runtime additionally gets the true-ink-bbox measurement these
// tests can't observe directly, but the sizing/no-manual-nudge contract is
// identical either way.

function svgOf(container) {
  return container.querySelector('svg');
}

describe('ProviderIcon', () => {
  it('renders a square mark at size x size, with no transform', () => {
    const { container } = render(<ProviderIcon maker="anthropic" size={15} />);
    const svg = svgOf(container);
    expect(svg).toHaveAttribute('width', '15');
    expect(svg).toHaveAttribute('height', '15');
    expect(svg.style.transform).toBe('');
  });

  it('shrinks a wider-than-tall mark\'s height, keeping width pinned to size', () => {
    // mindshub's viewBox (517x287, ~1.8:1) is the one genuinely non-square
    // mark — every other provider is square/near-square.
    const { container } = render(<ProviderIcon maker="mindshub" size={15} />);
    const svg = svgOf(container);
    expect(svg).toHaveAttribute('width', '15');
    expect(Number(svg.getAttribute('height'))).toBeLessThan(15);
    expect(Number(svg.getAttribute('height'))).toBeGreaterThan(0);
  });

  it('renders the neutral placeholder (outlined circle) for an unknown maker', () => {
    const { container } = render(<ProviderIcon maker="zai" size={15} />);
    const svg = svgOf(container);
    expect(svg).toHaveAttribute('width', '15');
    expect(svg).toHaveAttribute('height', '15');
    expect(container.querySelector('circle')).toBeInTheDocument();
  });

  it('applies no transform by default — auto-centering needs no manual nudge', () => {
    const { container } = render(<ProviderIcon maker="openai" size={15} />);
    expect(svgOf(container).style.transform).toBe('');
  });

  it('still honors an explicit nudgeY override when a caller passes one', () => {
    const { container } = render(<ProviderIcon maker="openai" size={15} nudgeY={-2} />);
    expect(svgOf(container)).toHaveStyle({ transform: 'translateY(-2px)' });
  });

  it('caches geometry per maker — two instances of the same maker render identically', () => {
    const a = render(<ProviderIcon maker="mindshub" size={15} />);
    const b = render(<ProviderIcon maker="mindshub" size={15} />);
    expect(svgOf(a.container).getAttribute('height')).toBe(svgOf(b.container).getAttribute('height'));
  });
});
