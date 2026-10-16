// The instant first take: a short reply on a fast model that says what Anton
// is about to do, shown above the steps while Anton works and gone when the
// turn asks the user or ends. It is a placeholder, not the answer, so it reads
// as one: muted, no actions, never persisted.
//
// It types out rather than landing in one block, quickly enough that the
// first words show at once and the whole take is in within about a second and
// a half. Reduced motion shows it whole.

import { useEffect, useRef, useState } from 'react';

const TICK_MS = 30;
// Ticks to catch up with whatever has arrived: ~1.5s for a whole take.
const CATCH_UP_TICKS = 50;

function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** How much of `text` to show: grows toward it a step per tick. */
export function useTypedText(text, { reduced = prefersReducedMotion() } = {}) {
  const [shown, setShown] = useState(reduced ? text.length : 0);
  const target = useRef(text.length);
  target.current = text.length;

  useEffect(() => {
    if (reduced) {
      setShown(text.length);
      return undefined;
    }
    if (shown >= text.length) return undefined;
    const step = Math.max(1, Math.ceil(text.length / CATCH_UP_TICKS));
    const id = setTimeout(() => setShown((n) => Math.min(target.current, n + step)), TICK_MS);
    return () => clearTimeout(id);
  }, [text, shown, reduced]);

  return text.slice(0, Math.min(shown, text.length));
}

export function FirstTake({ take }) {
  const text = take?.text || '';
  const typed = useTypedText(text);
  if (!text) return null;
  // The typing animation stays out of the live region, so a screen reader
  // announces the finished sentence once instead of every fragment.
  return (
    <>
      <p
        className="mb-2 whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink-3"
        data-testid="first-take"
        aria-hidden="true"
      >
        {typed}
      </p>
      <div className="sr-only" role="status" aria-live="polite">{take.done ? text : ''}</div>
    </>
  );
}
