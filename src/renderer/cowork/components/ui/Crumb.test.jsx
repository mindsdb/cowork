import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Crumb, CrumbCurrent } from './Crumb';

describe('Crumb', () => {
  it('renders a button with the label and fires onClick', () => {
    const onClick = vi.fn();
    render(<Crumb label="Home" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('forwards native button props (disabled, aria-*, data-*)', () => {
    render(<Crumb label="Back" disabled aria-current="page" data-testid="crumb" />);
    const btn = screen.getByTestId('crumb');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-current', 'page');
  });

  it('merges a custom className', () => {
    render(<Crumb label="X" className="extra" />);
    expect(screen.getByRole('button', { name: 'X' })).toHaveClass('extra');
  });
});

describe('CrumbCurrent', () => {
  it('forwards native span props', () => {
    render(<CrumbCurrent label="Now" data-testid="cur" aria-label="current page" />);
    const el = screen.getByTestId('cur');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveAttribute('aria-label', 'current page');
  });
});
