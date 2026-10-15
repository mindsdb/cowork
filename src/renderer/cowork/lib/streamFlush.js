import { flushSync } from 'react-dom';

const DELTA_FLUSH_MS = 16;

// Builds a per-stream flusher for the streaming row. Text deltas arrive many
// per network chunk, and committing the whole App tree synchronously for each
// one is the main per-token render cost, so deltas coalesce into one commit
// per frame. Every other event still commits synchronously: step and ask_user
// handling rely on that commit landing before the next event runs.
//
// `isLive` re-checks the stream when the deferred flush fires, so a stream
// that was stopped or replaced in between never re-adds its streaming row.
// Terminal handlers call `settle()` first: error recovery keeps the partial
// answer from the committed streaming row, so pending text must land before it.
export function createStreamFlusher(flush, isLive) {
  let timer = null;
  const settle = () => {
    if (timer == null) return;
    clearTimeout(timer);
    timer = null;
    flushSync(flush);
  };
  const event = (ev) => {
    if (ev?.type === 'response.output_text.delta') {
      if (timer == null) {
        timer = setTimeout(() => {
          timer = null;
          if (isLive()) flush();
        }, DELTA_FLUSH_MS);
      }
      return;
    }
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    flushSync(flush);
  };
  return { event, settle };
}
