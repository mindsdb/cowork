import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BrowserControlBadge from './BrowserControlBadge';

describe('BrowserControlBadge', () => {
  const cases = [
    ['disconnected', 'idle', 'Disconnected'],
    ['awaiting-approval', 'warn', 'Awaiting approval'],
    ['connected', 'ok', 'Connected'],
    ['lost', 'danger', 'Connection lost'],
  ];

  it.each(cases)('state %s -> tone %s + label %s', (state, tone, label) => {
    render(<BrowserControlBadge state={state} />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveClass(`channels-badge-${tone}`);
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveAttribute('aria-label', `Browser Control: ${label}`);
  });

  it('falls back to disconnected/idle for an unknown state', () => {
    render(<BrowserControlBadge state="bogus" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveClass('channels-badge-idle');
    expect(badge).toHaveTextContent('Disconnected');
  });
});
