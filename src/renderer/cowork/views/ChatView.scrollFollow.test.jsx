// How the transcript follows new content. A reader at the bottom stays there
// as the conversation grows; a reader who scrolled up to reread is left where
// they are, until they send something themselves.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

import { fakeScrollBox } from '../../../../tests/helpers/scrollBox';

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isMac: () => false,
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

import ChatView from './ChatView';

const taskWith = (messages, overrides = {}) => ({ id: 'conv-a', title: 'Alpha task', status: 'active', messages, ...overrides });
const first = [
  { role: 'user', id: 'u1', content: 'first question' },
  { role: 'assistant', id: 'a1', content: 'first answer' },
];
const scroller = (container) => container.querySelector('[data-scroll="true"]');

let box;
beforeEach(() => {
  box = fakeScrollBox((el) => el.dataset?.scroll === 'true');
  box.height = 2000;
  box.client = 600;
});
afterEach(() => box.restore());

describe('following new content', () => {
  it('opens a conversation at its end', () => {
    const { container } = render(<ChatView task={taskWith(first)} />);
    expect(scroller(container).scrollTop).toBe(1400);
  });

  it('keeps a reader at the bottom pinned as an answer arrives', () => {
    const messages = [...first, { role: 'user', id: 'u2', content: 'more' }];
    const { container, rerender } = render(<ChatView task={taskWith(messages)} isStreaming />);
    box.height = 2600;
    rerender(<ChatView task={taskWith([...messages, { role: 'assistant', id: 'a2', content: 'reply' }])} />);
    expect(scroller(container).scrollTop).toBe(2000);
  });

  it('leaves a reader who scrolled up where they are when an answer lands', () => {
    const messages = [...first, { role: 'user', id: 'u2', content: 'more' }];
    const { container, rerender } = render(<ChatView task={taskWith(messages)} isStreaming />);
    box.scrollReaderTo(scroller(container), 300);
    box.height = 2600;
    rerender(<ChatView task={taskWith([...messages, { role: 'assistant', id: 'a2', content: 'reply' }])} />);
    expect(scroller(container).scrollTop).toBe(300);
  });

  it('brings the message the reader sends to the top, with room below for the answer', () => {
    const { container, rerender } = render(<ChatView task={taskWith(first)} />);
    box.scrollReaderTo(scroller(container), 300);
    box.height = 2600;
    // No layout in happy-dom: the sent turn sits 2200px down the transcript.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const el = this;
      const top = el.dataset?.turnId === 'm:u2' ? 2200 - scroller(container).scrollTop : 0;
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON() {} };
    });
    const scrollTo = vi.spyOn(HTMLElement.prototype, 'scrollTo');
    try {
      rerender(<ChatView task={taskWith([...first, { role: 'user', id: 'u2', content: 'more' }])} />);
      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 2176 }));
      // 2176 + 600 visible − 2600 of content leaves 176px to reserve.
      expect(container.querySelector('.chat-scroller__reserve').style.height).toBe('176px');
    } finally {
      rect.mockRestore();
      scrollTo.mockRestore();
    }
  });

  it('opens another conversation at its end', () => {
    const { container, rerender } = render(<ChatView task={taskWith(first)} />);
    box.scrollReaderTo(scroller(container), 300);
    rerender(<ChatView task={taskWith(first, { id: 'conv-b' })} />);
    expect(scroller(container).scrollTop).toBe(1400);
  });
});
