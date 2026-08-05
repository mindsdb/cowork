import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Message from './Message';

describe('Message', () => {
  it('defaults to the error treatment', () => {
    render(<Message>Boom</Message>);
    expect(screen.getByText('Boom')).toHaveClass('text-danger-text');
  });

  it('applies a known variant', () => {
    render(<Message variant="success">Yay</Message>);
    expect(screen.getByText('Yay')).toHaveClass('text-success-text');
  });

  // Regression: consumers are JS and aren't bound by the TS union. An unknown
  // runtime variant must fall back to the error treatment, not render unthemed
  // (cva alone would emit only the base classes).
  it('falls back to error for an unknown runtime variant', () => {
    render(<Message variant="danger">Uh oh</Message>);
    const el = screen.getByText('Uh oh');
    expect(el).toHaveClass('text-danger-text');
    expect(el.className).not.toContain('undefined');
  });

  it('forwards native props and children', () => {
    render(<Message role="alert" data-testid="msg">Hi</Message>);
    expect(screen.getByTestId('msg')).toHaveAttribute('role', 'alert');
  });
});
