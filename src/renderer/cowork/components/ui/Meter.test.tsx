import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Meter from './Meter';

describe('Meter', () => {
  it('exposes the value as a progressbar', () => {
    render(<Meter value={0.87} label="Free monthly tokens used" />);
    const bar = screen.getByRole('progressbar', { name: 'Free monthly tokens used' });
    expect(bar).toHaveAttribute('aria-valuenow', '87');
    expect(bar.firstElementChild).toHaveStyle({ width: '87%' });
  });

  it('clamps out-of-range and junk values', () => {
    const { rerender } = render(<Meter value={1.7} label="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    rerender(<Meter value={-3} label="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    rerender(<Meter value={Number.NaN} label="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('paints the tone on the fill, not the track', () => {
    render(<Meter value={0.5} tone="danger" label="x" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.className).toContain('bg-surface-2');
    expect(bar.firstElementChild?.className).toContain('bg-danger');
  });
});
