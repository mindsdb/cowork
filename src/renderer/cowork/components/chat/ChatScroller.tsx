import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';

import Ico from '../Icons';
import { TurnMinimap } from './TurnMinimap';

import type { StickToBottom } from './useStickToBottom';
import './chat.css';

type ScrollAttributes = Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children' | 'onScroll'> & {
  [data: `data-${string}`]: string | undefined;
};

/**
 * The scrolling transcript shared by Cowork chat and Code Mode.
 *
 * Owns the scroll box and the stick-to-bottom behaviour (see
 * useStickToBottom); each surface keeps its own content and spacing. The end
 * of the content is padded by `--chat-dock-height` (see useDockInset) so the
 * last message scrolls clear of a composer floating over the transcript.
 * A reader scrolled away from the end gets a button back to it. Longer
 * conversations get a turn minimap on the left edge (TurnMinimap). `overlay`
 * renders over the scroll box too: the place for other controls that float
 * rather than scroll.
 */
export function ChatScroller({
  stick,
  className = '',
  contentClassName = '',
  scrollProps,
  overlay,
  children,
}: {
  stick: StickToBottom;
  className?: string;
  contentClassName?: string;
  scrollProps?: ScrollAttributes;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const { isStuck, scrollToBottom, isAtBottom } = stick;
  // Bumped when the content changes size or its nodes change, so the minimap
  // re-reads turns. Switching between two equally tall conversations swaps
  // the turns without a resize.
  const [layoutVersion, setLayoutVersion] = useState(0);
  const versionFrame = useRef(0);
  // Content that grows in place (a streamed answer, an opened tray) keeps a
  // pinned reader at the end without the transcript re-rendering.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return undefined;
    const bump = () => {
      cancelAnimationFrame(versionFrame.current);
      versionFrame.current = requestAnimationFrame(() => setLayoutVersion((v) => v + 1));
    };
    const resize = new ResizeObserver(() => {
      if (isStuck()) scrollToBottom('auto');
      bump();
    });
    resize.observe(content, { box: 'border-box' });
    const mutation = new MutationObserver(bump);
    mutation.observe(content, { childList: true, subtree: true });
    return () => { resize.disconnect(); mutation.disconnect(); cancelAnimationFrame(versionFrame.current); };
  }, [isStuck, scrollToBottom]);
  return (
    <div className="chat-scroller relative flex flex-1 flex-col min-h-0 min-w-0">
      <div
        {...scrollProps}
        ref={stick.scrollRef}
        onScroll={stick.onScroll}
        className={`chat-scroller__box flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden ${className}`}
      >
        <div ref={contentRef} className={`chat-scroller__content ${contentClassName}`}>
          {children}
        </div>
      </div>
      {!isAtBottom && (
        <button
          type="button"
          className="chat-jump"
          aria-label="Scroll to latest"
          onClick={() => {
            const reduce = typeof window.matchMedia === 'function'
              && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            scrollToBottom(reduce ? 'auto' : 'smooth');
          }}
        >
          {Ico.arrowDown(16)}
        </button>
      )}
      <TurnMinimap scrollRef={stick.scrollRef} version={layoutVersion} />
      {overlay}
    </div>
  );
}
