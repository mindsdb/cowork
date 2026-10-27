import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fakeScrollBox, type FakeScrollBox } from '../../../../../tests/helpers/scrollBox';
import { ChatScroller } from './ChatScroller';
import { useStickToBottom } from './useStickToBottom';

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
