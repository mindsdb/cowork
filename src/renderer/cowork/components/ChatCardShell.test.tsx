import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatCardShell, { cardActions, isSettledCardState } from './ChatCardShell';

describe('cardActions', () => {
  it('gives no bar for no buttons', () => {
    expect(cardActions([])).toBeNull();
  });

  it('puts the marked button first in rank, the next beside it, the rest in overflow', () => {
    const a = { label: 'A' };
    const b = { label: 'B', primary: true };
    const c = { label: 'C' };
    const bar = cardActions([a, b, c]);
    expect(bar?.primary).toBe(b);
    expect(bar?.secondary).toBe(a);
    expect(bar?.overflow).toEqual([{ label: 'C', onClick: undefined, disabled: undefined }]);
  });

  it('makes a lone unmarked button the primary rather than a borderless secondary', () => {
    // UsageAlertCard's only action, "View usage", is not marked primary.
    const only = { label: 'View usage' };
    const bar = cardActions([only]);
    expect(bar?.primary).toBe(only);
    expect(bar?.secondary).toBeNull();
  });
});

describe('ChatCardShell state', () => {
  const actions = { primary: { label: 'Send' }, secondary: { label: 'Skip' } };

  it('counts only answered, denied and expired as settled', () => {
    expect(['answered', 'denied', 'expired'].every((s) => isSettledCardState(s as never))).toBe(true);
    expect(isSettledCardState('pending')).toBe(false);
    expect(isSettledCardState('failed')).toBe(false);
    expect(isSettledCardState(undefined)).toBe(false);
  });

  it('keeps a pending card live, with no receipt', () => {
    const { container } = render(<ChatCardShell state="pending" actions={actions}>Body</ChatCardShell>);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(container.querySelector('.chat-card-shell__receipt')).toBeNull();
    expect(container.firstElementChild).toHaveAttribute('data-state', 'pending');
  });

  it.each([
    ['answered', 'Answered'],
    ['denied', 'Declined'],
    ['expired', 'No longer active'],
  ] as const)('drops the actions of a %s card and ends it in its receipt', (state, label) => {
    const { container } = render(<ChatCardShell state={state} actions={actions}>Body</ChatCardShell>);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(container.querySelector('.chat-card-shell__receipt')).toHaveTextContent(label);
  });

  it('says the caller\'s receipt in place of the state label', () => {
    const { container } = render(<ChatCardShell state="denied" receipt="Skipped.">Body</ChatCardShell>);
    expect(container.querySelector('.chat-card-shell__receipt')).toHaveTextContent('Skipped.');
    expect(screen.queryByText('Declined')).toBeNull();
  });

  it('keeps a failed card\'s actions and marks its kind row as danger', () => {
    render(<ChatCardShell state="failed" kind="Error" actions={{ primary: { label: 'Try again' } }}>Body</ChatCardShell>);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Error').parentElement).toHaveClass('text-danger');
  });

  it('shows a failed card\'s receipt only when the caller gives one', () => {
    const { container, rerender } = render(<ChatCardShell state="failed">Body</ChatCardShell>);
    expect(container.querySelector('.chat-card-shell__receipt')).toBeNull();
    rerender(<ChatCardShell state="failed" receipt="Reference: r-1">Body</ChatCardShell>);
    expect(container.querySelector('.chat-card-shell__receipt')).toHaveTextContent('Reference: r-1');
  });

  it('leaves a card with no state as it was', () => {
    const { container } = render(<ChatCardShell kind="Model" actions={actions}>Body</ChatCardShell>);
    expect(container.firstElementChild).not.toHaveAttribute('data-state');
    expect(screen.getByText('Model').parentElement).toHaveClass('text-ink-3');
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });
});
