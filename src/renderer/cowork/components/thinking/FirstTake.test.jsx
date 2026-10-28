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

describe('FirstTake — leaving (ENG-3554)', () => {
  it('folds away with its last text instead of vanishing, then unmounts', () => {
    vi.useFakeTimers();
    const { rerender } = render(<FirstTake take={{ text: 'Building it.', done: true }} />);
    advance(2000);
    rerender(<FirstTake take={null} />);
    // Still on screen, folding.
    expect(screen.getByTestId('first-take').textContent).toBe('Building it.');
    expect(screen.getByTestId('first-take-fold').className).toContain('is-folded');
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByTestId('first-take')).toBeNull();
  });
});

describe('FirstTake — leaving on the finished message (ENG-3554)', () => {
  it('mounts whole, folds away at once, and does not type out again', async () => {
    vi.useFakeTimers();
    render(<FirstTake take={null} leavingText="Building it." />);
    expect(screen.getByTestId('first-take').textContent).toBe('Building it.');
    act(() => { vi.advanceTimersByTime(20); });
    await act(async () => { vi.runOnlyPendingTimers(); });
    expect(screen.queryByTestId('first-take-fold')?.className ?? 'is-folded').toContain('is-folded');
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByTestId('first-take')).toBeNull();
  });
});
