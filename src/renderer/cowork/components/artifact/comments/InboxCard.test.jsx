import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InboxCard } from './InboxCard';

const THREAD = {
  id: 'thread-1',
  status: 'open',
  selector: null,
  created_at: '2026-08-25T12:00:00Z',
  payload: {
    author: { user_id: 'reviewer', email: 'reviewer@example.com' },
    text: 'Please clarify the outcome.',
    replies: [],
  },
};

describe('InboxCard collaboration actions', () => {
  it('keeps the agent action visible and labels whole-artifact feedback plainly', () => {
    render(
      <InboxCard
        thread={THREAD}
        viewer={{ user_id: 'owner', role: 'owner' }}
        canResolve
        canAddressWithAgent
        onAddressWithAgent={vi.fn()}
        onStatus={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Address with agent' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mark as resolved' })).toBeVisible();
    expect(screen.getByText('general')).toBeVisible();
    expect(screen.queryByText('unanchored')).not.toBeInTheDocument();
  });

  it('does not show owner decisions to reviewers', () => {
    render(
      <InboxCard
        thread={THREAD}
        viewer={{ user_id: 'reviewer', role: 'reviewer' }}
        onAddressWithAgent={vi.fn()}
        onStatus={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Address with agent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as resolved' })).not.toBeInTheDocument();
  });

  // Deleting your own comment is authorized by authorship, not by role — the
  // comments service answers 403 "not author", never "not owner". Gating it
  // behind `canResolve` also cost the owner their own Delete whenever the
  // service returns no capabilities at all (inference before #465).
  it('keeps Delete for the comment author without resolve rights', () => {
    render(
      <InboxCard
        thread={THREAD}
        viewer={{ user_id: 'reviewer', role: 'reviewer' }}
        onRequestDelete={vi.fn()}
        onStatus={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as resolved' })).not.toBeInTheDocument();
  });

  it('offers nothing on someone else\'s comment without resolve rights', () => {
    render(
      <InboxCard
        thread={THREAD}
        viewer={{ user_id: 'bystander', role: 'reviewer' }}
        onRequestDelete={vi.fn()}
        onStatus={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as resolved' })).not.toBeInTheDocument();
  });
});
