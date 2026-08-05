import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alert } from './Alert';

describe('Alert', () => {
  it('renders the body content', () => {
    render(<Alert>Something happened</Alert>);
    expect(screen.getByText('Something happened')).toBeInTheDocument();
  });

  it('defaults to the info variant with no live-region role', () => {
    const { container } = render(<Alert>Note</Alert>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('bg-info-bg');
    expect(el).not.toHaveAttribute('role');
  });

  it('applies the expected bg/border/text classes per variant', () => {
    const expected = {
      info: ['bg-info-bg', 'border-info-border', 'text-info-text'],
      success: ['bg-success-bg', 'border-success-border', 'text-success-text'],
      warning: ['bg-warning-bg', 'border-warning-border', 'text-warning-text'],
      danger: ['bg-danger-bg', 'border-danger-border', 'text-danger-text'],
    } as const;
    for (const variant of Object.keys(expected) as Array<keyof typeof expected>) {
      const { container, unmount } = render(<Alert variant={variant}>{variant}</Alert>);
      const cls = (container.firstChild as HTMLElement).className.split(/\s+/);
      expect(cls).toEqual(expect.arrayContaining([...expected[variant]]));
      unmount();
    }
  });

  it('marks danger and warning as live alerts, info/success as passive', () => {
    const { container: danger } = render(<Alert variant="danger">x</Alert>);
    expect(danger.firstChild).toHaveAttribute('role', 'alert');
    const { container: warning } = render(<Alert variant="warning">x</Alert>);
    expect(warning.firstChild).toHaveAttribute('role', 'alert');
    const { container: success } = render(<Alert variant="success">x</Alert>);
    expect(success.firstChild).not.toHaveAttribute('role');
  });

  it('lets an explicit role override the variant default', () => {
    const { container } = render(<Alert variant="danger" role="status">x</Alert>);
    expect(container.firstChild).toHaveAttribute('role', 'status');
  });

  it('renders a title and a leading icon when provided', () => {
    render(<Alert title="Heads up" icon={<svg data-testid="icon" />}>Body</Alert>);
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('merges a caller className without dropping variant classes', () => {
    const { container } = render(<Alert variant="danger" className="mt-4">x</Alert>);
    const cls = (container.firstChild as HTMLElement).className;
    expect(cls).toContain('mt-4');
    expect(cls).toContain('bg-danger-bg');
  });
});
