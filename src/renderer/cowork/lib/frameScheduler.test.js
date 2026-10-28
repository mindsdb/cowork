import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { frameScheduler } from './frameScheduler';

const FRAME_MS = 16;

describe('frameScheduler', () => {
  let clock;
  let renderCostMs;
  let render;
  let flush;
  let scheduler;

  // The scheduler reads the clock around each render; the test clock moves
  // with the fake timers and jumps by the render's cost while it runs.
  const advance = (ms) => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    clock = 1000;
    renderCostMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    render = vi.fn(() => { clock += renderCostMs; });
    flush = vi.fn();
    scheduler = frameScheduler({ render, flush });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders once on the next frame however many requests came before it', () => {
    for (let i = 0; i < 50; i += 1) scheduler.request();
    expect(render).not.toHaveBeenCalled();

    advance(FRAME_MS);

    expect(render).toHaveBeenCalledTimes(1);
  });

  it('renders on the next frame again when the last render was cheap', () => {
    scheduler.request();
    advance(FRAME_MS);
    scheduler.request();
    advance(FRAME_MS);

    expect(render).toHaveBeenCalledTimes(2);
  });

  it('leaves the main thread free for as long as the last render took', () => {
    renderCostMs = 100;
    scheduler.request();
    advance(FRAME_MS);
    expect(render).toHaveBeenCalledTimes(1);

    scheduler.request();
    advance(90);
    expect(render).toHaveBeenCalledTimes(1);

    advance(10 + FRAME_MS);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('writes a waiting render through flush instead and drops its frame', () => {
    scheduler.request();
    scheduler.flushPending();

    expect(flush).toHaveBeenCalledTimes(1);
    advance(FRAME_MS);
    expect(render).not.toHaveBeenCalled();
  });

  it('cancels a render waiting out the pause when flushed', () => {
    renderCostMs = 100;
    scheduler.request();
    advance(FRAME_MS);
    scheduler.request();
    scheduler.flushPending();

    advance(200);
    expect(render).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('does nothing on flush when no render is waiting', () => {
    scheduler.request();
    advance(FRAME_MS);
    scheduler.flushPending();

    expect(flush).not.toHaveBeenCalled();
  });

  it('keeps working after a flush', () => {
    scheduler.request();
    scheduler.flushPending();
    scheduler.request();
    advance(FRAME_MS);

    expect(render).toHaveBeenCalledTimes(1);
  });
});
