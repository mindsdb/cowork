import { fireEvent, render, screen } from '@testing-library/react';
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

describe('InboxCard agent action feedback', () => {
  const render_ = (props) => render(
    <InboxCard
      thread={THREAD}
      viewer={{ user_id: 'owner', role: 'owner' }}
      canResolve
      canAddressWithAgent
      onAddressWithAgent={vi.fn()}
      onStatus={vi.fn()}
      {...props}
    />,
  );

  it('says the request is starting while one is in flight', () => {
    // Clicking used to leave the button unchanged, so nothing on screen said
    // the click had registered until the turn card appeared in chat.
    render_({ agentBusy: true });

    const button = screen.getByRole('button', { name: /Starting/ });
    expect(button).toBeDisabled();
  });

  it('says the agent is working on this thread', () => {
    render_({ agentWorking: true });

    const button = screen.getByRole('button', { name: /Agent is working/ });
    expect(button).toBeDisabled();
  });

  it('does not report another thread\'s turn as this one\'s', () => {
    render_({ agentBusy: false, agentWorking: false });

    expect(screen.getByRole('button', { name: 'Address with agent' })).toBeEnabled();
  });

  it('cannot be clicked twice while a request is in flight', async () => {
    const onAddressWithAgent = vi.fn();
    render_({ agentBusy: true, onAddressWithAgent });

    screen.getByRole('button', { name: /Starting/ }).click();

    expect(onAddressWithAgent).not.toHaveBeenCalled();
  });
});

// Images (ENG-4410): the text's image markers show as thumbnails, read with
// the viewer's credential, never as the raw marker.
describe('InboxCard images', () => {
  const ID = '0123456789abcdef0123456789abcdef.png';
  const withImage = {
    ...THREAD,
    payload: { ...THREAD.payload, text: `Like this\n\n![shot.png](cowork-image:${ID})` },
  };

  it('shows the words and a thumbnail, not the marker', async () => {
    URL.createObjectURL ||= () => 'blob:thumb';
    URL.revokeObjectURL ||= () => {};
    const loadImage = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
    render(<InboxCard thread={withImage} viewer={{ user_id: 'owner', role: 'owner' }} loadImage={loadImage} />);

    expect(screen.getByText('Like this')).toBeInTheDocument();
    expect(screen.queryByText(/cowork-image:/)).not.toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'shot.png' })).toBeInTheDocument();
    expect(loadImage).toHaveBeenCalledWith(ID, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('says so when an image cannot be read', async () => {
    const loadImage = vi.fn(async () => { throw new Error('gone'); });
    render(<InboxCard thread={withImage} viewer={{ user_id: 'owner', role: 'owner' }} loadImage={loadImage} />);

    expect(await screen.findByText('Image unavailable')).toBeInTheDocument();
  });
});

describe('InboxCard queued for the agent', () => {
  it('says Queued and holds the button while the comment waits its turn', () => {
    render(
      <InboxCard
        thread={THREAD}
        viewer={{ user_id: 'owner', role: 'owner' }}
        canResolve
        canAddressWithAgent
        agentQueued
        onAddressWithAgent={vi.fn()}
        onStatus={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Queued' })).toBeDisabled();
  });
});

// A pinned label for comments on a part of the artifact, and editing your own
// comment right in its card (ENG-4383).
describe('InboxCard pinned and inline edit', () => {
  const IMG = '0123456789abcdef0123456789abcdef.png';
  const mineThread = {
    ...THREAD,
    selector: 'main > h2',
    payload: { ...THREAD.payload, text: `Old words\n\n![s.png](cowork-image:${IMG})` },
  };
  const reviewer = { user_id: 'reviewer', role: 'reviewer' };

  it('labels a comment pinned to the page, and explains it', () => {
    render(<InboxCard thread={mineThread} viewer={reviewer} />);
    expect(screen.getByText('pinned')).toBeInTheDocument();
  });

  it('labels no pin on a general comment or one on another slide', () => {
    const { rerender } = render(<InboxCard thread={THREAD} viewer={reviewer} />);
    expect(screen.queryByText('pinned')).toBeNull();
    rerender(<InboxCard thread={mineThread} state="hidden" viewer={reviewer} />);
    expect(screen.queryByText('pinned')).toBeNull();
  });

  it('edits your own comment in place on Enter, keeping its images, without going to it', () => {
    const onEditThread = vi.fn(async () => true);
    const onFocus = vi.fn();
    render(<InboxCard thread={mineThread} viewer={reviewer} onEditThread={onEditThread} onFocus={onFocus} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const box = screen.getByRole('textbox', { name: 'Edit comment' });
    expect(box).toHaveValue('Old words');
    fireEvent.change(box, { target: { value: 'New words' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(onEditThread).toHaveBeenCalledWith('thread-1', `New words\n\n![s.png](cowork-image:${IMG})`);
    expect(onFocus).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Edit comment' })).toBeNull();
  });

  it('saves when focus leaves the box, and cancels on Escape', () => {
    const onEditThread = vi.fn(async () => true);
    const { unmount } = render(<InboxCard thread={mineThread} viewer={reviewer} onEditThread={onEditThread} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit comment' }), { target: { value: 'Blurred' } });
    fireEvent.blur(screen.getByRole('textbox', { name: 'Edit comment' }));
    expect(onEditThread).toHaveBeenCalledTimes(1);
    unmount();

    render(<InboxCard thread={mineThread} viewer={reviewer} onEditThread={onEditThread} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit comment' }), { target: { value: 'Dropped' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit comment' }), { key: 'Escape' });
    expect(onEditThread).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Old words')).toBeInTheDocument();
  });

  it("offers no edit on someone else's comment", () => {
    render(<InboxCard thread={mineThread} viewer={{ user_id: 'owner', role: 'owner' }} onEditThread={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});

describe('InboxCard holding its thread (a doc)', () => {
  const withReply = {
    ...THREAD,
    payload: {
      ...THREAD.payload,
      replies: [{ id: 'r1', text: 'Done in the summary.', author: { user_id: 'owner', email: 'owner@example.com' } }],
    },
  };

  it('shows the replies and a box to reply while open, and nothing more while closed', async () => {
    const onReply = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<InboxCard thread={withReply} viewer={{ user_id: 'owner' }} onReply={onReply} />);
    expect(screen.queryByText('Done in the summary.')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Reply to this comment' })).toBeNull();

    rerender(<InboxCard thread={withReply} viewer={{ user_id: 'owner' }} onReply={onReply} expanded />);
    expect(screen.getByText('Done in the summary.')).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Reply to this comment' });
    fireEvent.change(box, { target: { value: 'Thanks' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await vi.waitFor(() => expect(onReply).toHaveBeenCalledWith('thread-1', 'Thanks', []));
  });

  it('keeps replies in the popover where the card has no onReply', () => {
    render(<InboxCard thread={withReply} viewer={{ user_id: 'owner' }} expanded />);
    expect(screen.queryByRole('textbox', { name: 'Reply to this comment' })).toBeNull();
  });
});
