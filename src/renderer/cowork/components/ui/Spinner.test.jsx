import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Spinner from './Spinner';

describe('Spinner', () => {
  it('forwards native props and merges className', () => {
    render(<Spinner data-testid="sp" title="loading" className="extra" />);
    const el = screen.getByTestId('sp');
    expect(el).toHaveAttribute('title', 'loading');
    expect(el).toHaveClass('extra');
  });

  it('is aria-hidden by default but lets callers override', () => {
    const { rerender } = render(<Spinner data-testid="sp" />);
    expect(screen.getByTestId('sp')).toHaveAttribute('aria-hidden', 'true');
    rerender(<Spinner data-testid="sp" aria-hidden={false} aria-label="loading" />);
    expect(screen.getByTestId('sp')).toHaveAttribute('aria-label', 'loading');
  });
});
