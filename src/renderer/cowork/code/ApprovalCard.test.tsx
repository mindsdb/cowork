import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
    screen.getByRole('button', { name: 'Approve once' }).click();
    screen.getByRole('button', { name: 'Allow now and allow for similar commands' }).click();
    expect(onDecision.mock.calls.map((call) => call[0])).toEqual(['deny', 'approve_once', 'approve_session']);
    expect(screen.getByText('C:\\work\\repo')).toBeInTheDocument();
  });

  it('does not offer a session-wide decision without an engine policy amendment', () => {
    render(<ApprovalCard approval={{ ...approval, allow_session: false }} busy={false} onDecision={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Allow now and allow for similar commands' })).toBeNull();
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
