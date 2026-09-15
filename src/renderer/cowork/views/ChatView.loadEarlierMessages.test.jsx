// ENG-2768: the "load earlier messages" affordance only appears when the
// task's most recent page doesn't cover its whole history
// (hasMoreMessages), and defers entirely to the caller for the actual
// fetch/merge — ChatView just renders the button and reports the click.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ChatView from './ChatView';

const taskWith = (overrides) => ({
  id: 'conv-a',
  title: 'Alpha task',
  status: 'active',
  messages: [{ role: 'user', content: 'hi', id: 'm1' }],
  ...overrides,
});

describe('the "load earlier messages" affordance', () => {
  it('does not render when the task has no more messages to load', () => {
    render(<ChatView task={taskWith({ hasMoreMessages: false })} />);
    expect(screen.queryByRole('button', { name: /load earlier messages/i })).not.toBeInTheDocument();
  });

  it('does not render when hasMoreMessages was never set (no caller opted in)', () => {
    render(<ChatView task={taskWith({})} />);
    expect(screen.queryByRole('button', { name: /load earlier messages/i })).not.toBeInTheDocument();
  });

  it('renders and calls onLoadEarlierMessages when clicked', async () => {
    const user = userEvent.setup();
    const onLoadEarlierMessages = vi.fn();
    render(<ChatView task={taskWith({ hasMoreMessages: true })} onLoadEarlierMessages={onLoadEarlierMessages} />);

    const button = screen.getByRole('button', { name: /load earlier messages/i });
    await user.click(button);

    expect(onLoadEarlierMessages).toHaveBeenCalledTimes(1);
  });

  it('shows a loading label and disables the button while a page is in flight', () => {
    render(
      <ChatView
        task={taskWith({ hasMoreMessages: true })}
        onLoadEarlierMessages={vi.fn()}
        loadingEarlierMessages
      />,
    );

    const button = screen.getByRole('button', { name: /loading/i });
    expect(button).toBeDisabled();
  });
});
