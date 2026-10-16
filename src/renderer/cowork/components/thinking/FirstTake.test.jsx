import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { FirstTake } from './FirstTake';

afterEach(() => vi.useRealTimers());

// One tick at a time: each tick's timer is set by the render after the last.
function advance(ms) {
  for (let t = 0; t < ms; t += 30) act(() => { vi.advanceTimersByTime(30); });
}

describe('FirstTake', () => {
  it('types the take out, first words at once and all of it soon after', () => {
    vi.useFakeTimers();
    const text = "I'll pull last quarter's revenue by region and chart it.";
    render(<FirstTake take={{ text, done: true }} />);
    advance(90);
    const early = screen.getByTestId('first-take').textContent;
    expect(early.length).toBeGreaterThan(0);
    expect(early.length).toBeLessThan(text.length);
    advance(1600);
    expect(screen.getByTestId('first-take').textContent).toBe(text);
  });

  it('announces the finished sentence once, not each typed fragment', () => {
    vi.useFakeTimers();
    const text = "I'll pull your sales.";
    const { rerender } = render(<FirstTake take={{ text, done: false }} />);
    advance(90);
    expect(screen.getByRole('status').textContent).toBe('');
    rerender(<FirstTake take={{ text, done: true }} />);
    expect(screen.getByRole('status').textContent).toBe(text);
  });

  it('renders nothing without a take', () => {
    const { container } = render(<FirstTake take={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
