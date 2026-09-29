import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ApprovalCard } from './ApprovalCard';


const approval = {
  id: 'approval-1',
  kind: 'command',
  title: 'Run command',
  detail: 'npm test',
  cwd: 'C:\\work\\repo',
  risk: 'This command may modify files.',
  scope: 'This task only',
  allow_session: true,
};


describe('ApprovalCard', () => {
  it('keeps deny, one-time approval, and narrow session approval distinct', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard approval={approval} busy={false} onDecision={onDecision} />);
    screen.getByRole('button', { name: 'Deny' }).click();
    screen.getByRole('button', { name: 'Allow once' }).click();
    screen.getByRole('button', { name: 'Always allow' }).click();
    expect(onDecision.mock.calls.map((call) => call[0])).toEqual(['deny', 'approve_once', 'approve_session']);
    expect(screen.getByText('C:\\work\\repo')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Run this command?' })).toBeInTheDocument();
  });

  it('does not offer a session-wide decision without an engine policy amendment', () => {
    render(<ApprovalCard approval={{ ...approval, allow_session: false }} busy={false} onDecision={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Always allow' })).toBeNull();
  });

  it('takes focus when it appears so Enter allows once and Escape denies', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard approval={approval} busy={false} onDecision={onDecision} />);
    const tray = screen.getByRole('region', { name: 'Approval required' });
    expect(tray).toHaveFocus();

    fireEvent.keyDown(tray, { key: 'Enter' });
    fireEvent.keyDown(tray, { key: 'Escape' });
    fireEvent.keyDown(tray, { key: 'Enter', metaKey: true });
    expect(onDecision.mock.calls.map((call) => call[0])).toEqual(['approve_once', 'deny']);
  });

  it('leaves focus with a draft being typed, so its Enter never becomes a decision', () => {
    const draft = document.createElement('textarea');
    document.body.append(draft);
    draft.focus();
    const onDecision = vi.fn();
    render(<ApprovalCard approval={approval} busy={false} onDecision={onDecision} />);

    expect(draft).toHaveFocus();
    fireEvent.keyDown(draft, { key: 'Enter' });
    expect(onDecision).not.toHaveBeenCalled();
    draft.remove();
  });

  it('ignores the shortcuts while a decision is being saved', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard approval={approval} busy onDecision={onDecision} />);
    fireEvent.keyDown(screen.getByRole('region', { name: 'Approval required' }), { key: 'Enter' });
    expect(onDecision).not.toHaveBeenCalled();
  });

  it('disables every decision while an approval is being saved', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard approval={approval} busy onDecision={onDecision} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
      button.click();
    }
    expect(onDecision).not.toHaveBeenCalled();
  });

  it('does not add task/command scope jargon beneath the actions', () => {
    render(<ApprovalCard approval={approval} busy={false} onDecision={vi.fn()} />);
    expect(screen.queryByText('This task only')).not.toBeInTheDocument();
  });
});
