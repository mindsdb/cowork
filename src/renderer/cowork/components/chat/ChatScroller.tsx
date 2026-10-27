import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';

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
 * `overlay` renders over the scroll box, above the dock: the place for
 * controls that float with the transcript rather than scroll with it.
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
  const { isStuck, scrollToBottom } = stick;
  // Content that grows in place (a streamed answer, an opened tray) keeps a
  // pinned reader at the end without the transcript re-rendering.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => { if (isStuck()) scrollToBottom('auto'); });
    observer.observe(content, { box: 'border-box' });
    return () => observer.disconnect();
  }, [isStuck, scrollToBottom]);
  return (
    <div className="chat-scroller relative flex flex-1 flex-col min-h-0 min-w-0">
      <div
        {...scrollProps}
        ref={stick.scrollRef}
        onScroll={stick.onScroll}
        className={`chat-scroller__box flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${className}`}
      >
        <div ref={contentRef} className={`chat-scroller__content ${contentClassName}`}>
          {children}
        </div>
      </div>
      {overlay}
    </div>
  );
}
