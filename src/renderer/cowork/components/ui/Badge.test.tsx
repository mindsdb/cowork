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

  it('applies the expected foreground, background, and border classes for each variant', () => {
    const expectedClasses = {
      default: ['border-line', 'bg-surface-2', 'text-ink-2'],
      accent: [
        'border-[color-mix(in_srgb,var(--accent)_30%,transparent)]',
        'bg-accent-bg',
        'text-accent',
      ],
      success: ['border-success-border', 'bg-success-bg', 'text-success-text'],
      warning: ['border-warning-border', 'bg-warning-bg', 'text-warning'],
      danger: ['border-danger-border', 'bg-danger-bg', 'text-danger'],
      muted: ['border-transparent', 'bg-surface-2', 'text-ink-3'],
      inverse: [
        'border-[rgba(255,255,255,0.2)]',
        'bg-[rgba(255,255,255,0.16)]',
        'text-[rgba(255,255,255,0.86)]',
      ],
    } as const;

    for (const variant of Object.keys(expectedClasses) as Array<keyof typeof expectedClasses>) {
      const expected = expectedClasses[variant];
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>);
      expect(screen.getByText(variant).className.split(/\s+/)).toEqual(
        expect.arrayContaining([...expected]),
      );
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
    expect(el.className).toContain('text-success-text');
  });

  it('forwards rest props like title', () => {
    render(<Badge title="Public">Public</Badge>);
    expect(screen.getByText('Public')).toHaveAttribute('title', 'Public');
  });
});
