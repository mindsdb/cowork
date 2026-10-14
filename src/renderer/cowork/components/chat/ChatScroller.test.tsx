import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeScrollBox, type FakeScrollBox } from '../../../../../tests/helpers/scrollBox';
import { ChatScroller } from './ChatScroller';
import { anchorPlan, useStickToBottom, type StickToBottom } from './useStickToBottom';

function Transcript() {
  const stick = useStickToBottom();
  return (
    <ChatScroller stick={stick} scrollProps={{ 'data-scroll': 'true' }}>
      <p>Conversation</p>
    </ChatScroller>
  );
}

const box = () => document.querySelector('[data-scroll="true"]') as HTMLElement;

describe('the scroll-to-latest button', () => {
  let fake: FakeScrollBox;
  beforeEach(() => {
    fake = fakeScrollBox((el) => el.dataset?.scroll === 'true');
    fake.height = 2000;
    fake.client = 600;
  });
  afterEach(() => fake.restore());

  it('is absent while the reader is at the end', () => {
    render(<Transcript />);
    act(() => fake.scrollReaderTo(box(), 1400));
    expect(screen.queryByRole('button', { name: /scroll to latest/i })).toBeNull();
  });

  it('waits until the reader is a screen away', () => {
    render(<Transcript />);
    act(() => fake.scrollReaderTo(box(), 1400));
    act(() => fake.scrollReaderTo(box(), 900));
    expect(screen.queryByRole('button', { name: /scroll to latest/i })).toBeNull();
    act(() => fake.scrollReaderTo(box(), 700));
    expect(screen.getByRole('button', { name: 'Scroll to latest' })).toBeInTheDocument();
  });

  it('appears once the reader scrolls up, and takes them back to the end', () => {
    render(<Transcript />);
    act(() => fake.scrollReaderTo(box(), 1400));
    act(() => fake.scrollReaderTo(box(), 200));
    const jump = screen.getByRole('button', { name: 'Scroll to latest' });
    act(() => { fireEvent.click(jump); });
    expect(box().scrollTop).toBe(1400);
    expect(screen.queryByRole('button', { name: /scroll to latest/i })).toBeNull();
  });

  it('comes back within reach of the end without the button', () => {
    render(<Transcript />);
    act(() => fake.scrollReaderTo(box(), 1400));
    act(() => fake.scrollReaderTo(box(), 200));
    act(() => fake.scrollReaderTo(box(), 1350));
    expect(screen.queryByRole('button', { name: /scroll to latest/i })).toBeNull();
  });
});

describe('anchorPlan', () => {
  it('rests a sent turn just below the top and reserves only the room it needs', () => {
    expect(anchorPlan({ turnTop: 2200, baseHeight: 2600, clientHeight: 600 })).toEqual({ target: 2176, reserve: 176 });
    // An answer longer than the view needs no reserved room.
    expect(anchorPlan({ turnTop: 2200, baseHeight: 3400, clientHeight: 600 })).toEqual({ target: 2176, reserve: 0 });
  });
});

describe('when following pauses', () => {
  let fake: FakeScrollBox;
  let probe: StickToBottom;
  function Probe({ children }: { children?: ReactNode }) {
    probe = useStickToBottom();
    return (
      <ChatScroller stick={probe} scrollProps={{ 'data-scroll': 'true' }}>
        <p>Conversation</p>
        {children}
      </ChatScroller>
    );
  }
  beforeEach(() => {
    fake = fakeScrollBox((el) => el.dataset?.scroll === 'true');
    fake.height = 2000;
    fake.client = 600;
  });
  afterEach(() => fake.restore());

  it('unpins on a wheel scroll up, before the position moves far', () => {
    render(<Probe />);
    act(() => fake.scrollReaderTo(box(), 1400));
    act(() => { fireEvent.wheel(box(), { deltaY: -40 }); });
    expect(probe.isStuck()).toBe(false);
  });

  it('unpins while the reader selects text in the transcript, and stays unpinned near the end', () => {
    render(<Probe />);
    act(() => fake.scrollReaderTo(box(), 1400));
    const text = screen.getByText('Conversation').firstChild as Node;
    const getSelection = vi.spyOn(document, 'getSelection').mockReturnValue({ isCollapsed: false, anchorNode: text } as unknown as Selection);
    try {
      act(() => { document.dispatchEvent(new Event('selectionchange')); });
      expect(probe.isStuck()).toBe(false);
      act(() => fake.scrollReaderTo(box(), 1390));
      expect(probe.isStuck()).toBe(false);
    } finally {
      getSelection.mockRestore();
    }
  });

  it('unpins when the reader opens a collapsed block', () => {
    render(<Probe><details><summary>Worked for 2m</summary><p>Steps</p></details></Probe>);
    act(() => fake.scrollReaderTo(box(), 1400));
    act(() => { fireEvent.click(screen.getByText('Worked for 2m')); });
    expect(probe.isStuck()).toBe(false);
  });
});

describe('a sent message held at the top', () => {
  let fake: FakeScrollBox;
  let stick: ReturnType<typeof useStickToBottom>;
  // The content's height without the reserved room; the box's scroll height
  // is that plus whatever room the hook reserves.
  let base = 800;
  const reserve = () => document.querySelector('.chat-scroller__reserve') as HTMLElement;
  const reserved = () => parseFloat(reserve()?.style.height || '') || 0;

  function Sent() {
    stick = useStickToBottom();
    return (
      <ChatScroller stick={stick} scrollProps={{ 'data-scroll': 'true' }}>
        <div data-turn-id="t0">Plan the launch</div>
      </ChatScroller>
    );
  }

  beforeEach(() => {
    base = 800;
    fake = fakeScrollBox((el) => el.dataset?.scroll === 'true');
    Object.defineProperty(fake, 'height', { get: () => base + reserved() });
    fake.client = 600;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) { return this === reserve() ? reserved() : 0; },
    });
  });
  afterEach(() => {
    fake.restore();
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  });

  function send() {
    render(<Sent />);
    const turn = document.querySelector('[data-turn-id]') as HTMLElement;
    turn.getBoundingClientRect = () => ({ top: 300 } as DOMRect);
    act(() => fake.scrollReaderTo(box(), 200));
    act(() => stick.anchorLastTurn('auto'));
  }

  it('resumes following once the reader drags the scrollbar to the end', () => {
    send();
    expect(stick.isStuck()).toBe(false);
    act(() => { fireEvent.pointerDown(box()); });
    act(() => fake.scrollReaderTo(box(), base + reserved() - 600));
    expect(stick.isStuck()).toBe(true);
  });

  it('keeps the anchor through a press on the content', () => {
    send();
    act(() => { fireEvent.pointerDown(document.querySelector('[data-turn-id]')!); });
    act(() => fake.scrollReaderTo(box(), base + reserved() - 600));
    expect(stick.isStuck()).toBe(false);
  });

  it('reaches the send position when the reserved room grows after the scroll', () => {
    send();
    expect(box().scrollTop).toBe(476);
    // The composer shrinks after the send: less content, so the browser
    // clamps the scroll before the reserve catches up.
    base = 700;
    box().scrollTop = box().scrollTop;
    expect(box().scrollTop).toBe(376);
    act(() => stick.updateReserve());
    expect(box().scrollTop).toBe(476);
  });
});

describe('the transcript', () => {
  it('is a log, so new entries are announced politely', () => {
    render(<Transcript />);
    expect(screen.getByRole('log')).toBe(box());
  });
});
