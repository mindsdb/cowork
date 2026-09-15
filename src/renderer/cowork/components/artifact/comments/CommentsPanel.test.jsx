import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommentsPanel } from './CommentsPanel';

// The panel is mostly presentation; these two cases are the decisions it owns.

const VIEWER = { user_id: 'owner-user', email: 'owner@example.com', role: 'owner' };

const thread = (id, status, text) => ({
  id,
  status,
  created_at: '2026-08-25T12:00:00+00:00',
  payload: { author: { user_id: 'owner-user', email: 'owner@example.com' }, text },
});

const THREADS = [
  thread('t-open', 'open', 'Still needs a decision.'),
  thread('t-resolved', 'resolved', 'Handled already.'),
  thread('t-dismissed', 'dismissed', 'Rejected feedback.'),
];

function open(props = {}) {
  const onDeleteThread = vi.fn();
  render(
    <CommentsPanel
      threads={THREADS}
      viewer={VIEWER}
      onDeleteThread={onDeleteThread}
      {...props}
    />,
  );
  return { onDeleteThread, user: userEvent.setup() };
}

describe('CommentsPanel', () => {
  // Dismissing is the owner rejecting feedback. Resurfacing it in any tab —
  // "All" included — puts a settled decision back in front of them as if it
  // were still pending.
  it('never lists a dismissed thread, not even under All', async () => {
    const { user } = open();

    expect(screen.getByText('Still needs a decision.')).toBeVisible();
    expect(screen.queryByText('Rejected feedback.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));

    expect(screen.getByText('Still needs a decision.')).toBeVisible();
    expect(screen.getByText('Handled already.')).toBeVisible();
    expect(screen.queryByText('Rejected feedback.')).not.toBeInTheDocument();
  });

  // Deleting a thread is irreversible and has no undo, so the menu item must
  // only ever arm the confirmation — never dispatch the delete itself.
  // One thread on purpose: which card the kebab belongs to is then fixed by the
  // fixture, not by the panel's sort order, which this case says nothing about.
  it('deletes only after the confirmation is accepted', async () => {
    const { onDeleteThread, user } = open({ threads: [THREADS[0]] });

    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(onDeleteThread).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDeleteThread).toHaveBeenCalledWith('t-open');
  });
});
