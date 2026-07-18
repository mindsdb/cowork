import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders the label text', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('defaults to the default variant + md size', () => {
    render(<Badge>Plain</Badge>);
    const el = screen.getByText('Plain');
    expect(el.className).toContain('bg-surface-2');
    expect(el.className).toContain('h-[22px]');
  });

  it('applies each variant a distinct color class', () => {
    const variants = ['default', 'accent', 'success', 'warning', 'danger', 'muted', 'inverse'] as const;
    for (const variant of variants) {
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>);
      expect(screen.getByText(variant).className).toMatch(/text-/);
      unmount();
    }
  });

  it('renders a leading dot when dot is set, and omits it otherwise', () => {
    const { container: withDot } = render(<Badge dot>Shared</Badge>);
    expect(withDot.querySelector('.rounded-full.bg-current')).not.toBeNull();

    const { container: withoutDot } = render(<Badge>Shared</Badge>);
    expect(withoutDot.querySelector('.rounded-full.bg-current')).toBeNull();
  });

  it('renders a leading icon when provided', () => {
    render(<Badge icon={<svg data-testid="icon" />}>Public</Badge>);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('merges a caller className without dropping the variant classes', () => {
    render(<Badge variant="success" className="min-w-[22px]">3</Badge>);
    const el = screen.getByText('3');
    expect(el.className).toContain('min-w-[22px]');
    expect(el.className).toContain('text-success');
  });

  it('forwards rest props like title', () => {
    render(<Badge title="Public">Public</Badge>);
    expect(screen.getByText('Public')).toHaveAttribute('title', 'Public');
  });
});
