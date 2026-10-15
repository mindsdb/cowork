import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamFlusher } from './streamFlush';

const DELTA = { type: 'response.output_text.delta', delta: 'x' };
const STEP = { type: 'response.output_item.added' };

describe('createStreamFlusher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces a burst of text deltas into one deferred flush', () => {
    const flush = vi.fn();
    const { event: onEvent } = createStreamFlusher(flush, () => true);
    onEvent(DELTA);
    onEvent(DELTA);
    onEvent(DELTA);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('flushes non-delta events synchronously and absorbs a pending delta flush', () => {
    const flush = vi.fn();
    const { event: onEvent } = createStreamFlusher(flush, () => true);
    onEvent(DELTA);
    onEvent(STEP);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(16);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('drops the deferred flush when the stream is no longer live', () => {
    const flush = vi.fn();
    let live = true;
    const { event: onEvent } = createStreamFlusher(flush, () => live);
    onEvent(DELTA);
    live = false;
    vi.advanceTimersByTime(16);
    expect(flush).not.toHaveBeenCalled();
  });

  it('settle commits pending text at once, even after the stream was released', () => {
    const flush = vi.fn();
    const { event, settle } = createStreamFlusher(flush, () => false);
    event(DELTA);
    settle();
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(16);
    expect(flush).toHaveBeenCalledTimes(1);
    settle();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
