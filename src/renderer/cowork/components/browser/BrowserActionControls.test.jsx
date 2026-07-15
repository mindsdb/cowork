import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BrowserActionControls from './BrowserActionControls';

describe('BrowserActionControls', () => {
  it('renders the active domain and both control pills', () => {
    render(<BrowserActionControls domain="stripe.com" onStop={vi.fn()} onBrowserTakeOver={vi.fn()} />);
    expect(screen.getByText(/Browsing stripe.com/)).toBeInTheDocument();
    // Group is labelled for screen readers.
    expect(screen.getByRole('group', { name: 'Browser action controls' })).toBeInTheDocument();
  });

  it('falls back to a generic label when no domain is known', () => {
    render(<BrowserActionControls onStop={vi.fn()} onBrowserTakeOver={vi.fn()} />);
    expect(screen.getByText(/Browsing the approved tab/)).toBeInTheDocument();
  });

  it('Stop pill has an aria-label and fires onStop', () => {
    const onStop = vi.fn();
    render(<BrowserActionControls domain="a.com" onStop={onStop} onBrowserTakeOver={vi.fn()} />);
    const stop = screen.getByRole('button', { name: 'Stop the browser action' });
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('Take over pill has an aria-label and fires onBrowserTakeOver', () => {
    const onTakeOver = vi.fn();
    render(<BrowserActionControls domain="a.com" onStop={vi.fn()} onBrowserTakeOver={onTakeOver} />);
    const take = screen.getByRole('button', { name: 'Take over the browser tab' });
    fireEvent.click(take);
    expect(onTakeOver).toHaveBeenCalledTimes(1);
  });

  it('both pills are keyboard-focusable buttons (not divs)', () => {
    render(<BrowserActionControls domain="a.com" onStop={vi.fn()} onBrowserTakeOver={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    buttons.forEach((b) => expect(b.tagName).toBe('BUTTON'));
  });

  it('announces the active domain politely to screen readers', () => {
    render(<BrowserActionControls domain="stripe.com" onStop={vi.fn()} onBrowserTakeOver={vi.fn()} />);
    const label = screen.getByText(/Browsing stripe.com/);
    expect(label).toHaveAttribute('aria-live', 'polite');
  });
});
