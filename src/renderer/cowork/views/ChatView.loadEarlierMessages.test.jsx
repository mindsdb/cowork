// The "load earlier messages" affordance only appears when the
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

  // The ticket asks for lazy-loading on scroll-up, not only a button. happy-dom
  // has no IntersectionObserver, so the sentinel is driven directly here.
  it('loads the next older page when the top of the transcript comes into view', () => {
    const observers = [];
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; observers.push(this); }
      observe(el) { this.el = el; }
      disconnect() {}
    };
    try {
      const onLoadEarlierMessages = vi.fn();
      render(
        <ChatView
          task={taskWith({ hasMoreMessages: true })}
          onLoadEarlierMessages={onLoadEarlierMessages}
        />,
      );
      expect(observers.length).toBeGreaterThan(0);
      expect(onLoadEarlierMessages).not.toHaveBeenCalled();

      observers[observers.length - 1].cb([{ isIntersecting: true }]);
      expect(onLoadEarlierMessages).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.IntersectionObserver = original;
    }
  });

  it('does not observe anything when there is no more history to load', () => {
    const observers = [];
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; observers.push(this); }
      observe() {}
      disconnect() {}
    };
    try {
      render(
        <ChatView task={taskWith({ hasMoreMessages: false })} onLoadEarlierMessages={vi.fn()} />,
      );
      expect(observers).toHaveLength(0);
    } finally {
      globalThis.IntersectionObserver = original;
    }
  });
});
