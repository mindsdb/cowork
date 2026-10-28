// Paces the live render of a streaming answer. Stream events arrive far more
// often than the screen updates, so a render is requested per event but runs
// at most once per animation frame, and after each render the main thread
// stays free at least as long as that render took. A long answer therefore
// slows the redraw rate instead of blocking scrolling and clicks.

/**
 * `render` draws the latest state and is timed, so it must do its work
 * synchronously. `flush` writes the latest state without drawing; it runs
 * instead of a render still waiting when the stream ends.
 */
export function frameScheduler({ render, flush }) {
  let timer = 0;
  let frame = 0;
  let pending = false;
  let readyAt = 0;

  const runFrame = () => {
    frame = 0;
    if (!pending) return;
    pending = false;
    const start = performance.now();
    render();
    const end = performance.now();
    readyAt = end + (end - start);
  };

  const armFrame = () => {
    timer = 0;
    frame = requestAnimationFrame(runFrame);
  };

  return {
    request() {
      pending = true;
      if (frame || timer) return;
      const wait = readyAt - performance.now();
      if (wait > 0) timer = setTimeout(armFrame, wait);
      else armFrame();
    },
    flushPending() {
      if (!pending) return;
      pending = false;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      timer = 0;
      frame = 0;
      flush();
    },
  };
}
