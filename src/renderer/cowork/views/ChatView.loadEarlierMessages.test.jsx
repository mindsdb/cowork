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

describe('scroll position across a prepend', () => {
  // happy-dom does no layout, so the transcript's scroll box reports a height
  // the test controls and keeps whatever scrollTop the effect writes.
  function fakeScrollBox() {
    const box = { height: 0, tops: new WeakMap() };
    const isBox = (el) => el.dataset?.scroll === 'true';
    const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const originalTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() { return isBox(this) ? box.height : 0; },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get() { return box.tops.get(this) ?? 0; },
      set(v) { box.tops.set(this, v); },
    });
    // happy-dom defines both higher up the chain, so usually there is nothing
    // of HTMLElement's own to put back and the override is just removed.
    const put = (name, original) => {
      if (original) Object.defineProperty(HTMLElement.prototype, name, original);
      else delete HTMLElement.prototype[name];
    };
    box.restore = () => {
      put('scrollHeight', originalHeight);
      put('scrollTop', originalTop);
    };
    return box;
  }

  it('holds the reader in place when content above grew before the older page landed', () => {
    const observers = [];
    const originalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; this.els = []; observers.push(this); }
      observe(el) { this.els.push(el); }
      disconnect() {}
    };
    const box = fakeScrollBox();
    try {
      const newest = [
        { role: 'user', id: 'u2', content: 'Turn two question' },
        { role: 'assistant', id: 'a2', content: 'Turn two answer' },
      ];
      box.height = 1000;
      const { rerender } = render(<ChatView task={taskWith({ hasMoreMessages: true, messages: newest })} />);
      const scroller = document.querySelector('[data-scroll="true"]');
      scroller.scrollTop = 100;

      // An image finishes loading: 600px more content, same message count.
      box.height = 1600;
      observers
        .filter((o) => o.els.some((el) => el.classList?.contains('chat-transcript-col')))
        .forEach((o) => o.cb([]));

      // The older page adds 400px above.
      box.height = 2000;
      rerender(<ChatView task={taskWith({
        hasMoreMessages: false,
        messages: [
          { role: 'user', id: 'u1', content: 'Turn one question' },
          { role: 'assistant', id: 'a1', content: 'Turn one answer' },
          ...newest,
        ],
      })} />);

      expect(scroller.scrollTop).toBe(500);
    } finally {
      box.restore();
      globalThis.ResizeObserver = originalRO;
    }
  });
});
