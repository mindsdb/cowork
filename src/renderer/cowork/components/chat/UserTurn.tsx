import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { MarkdownContent } from '../markdown/MarkdownContent';
import { trimCopiedSelection } from '../../lib/clipboard';

// Long user messages clamp to ~8 lines behind a "Show more" toggle so a big
// pasted prompt doesn't dominate the viewport before the answer starts.
export const USER_CLAMP_MAX_PX = 176;

/**
 * The user's side of a chat turn, shared by Cowork chat and Code Mode: a
 * right-aligned bubble rendering the message as markdown, clamped when long,
 * with optional attachments and an action row (TurnActions) beneath it.
 *
 * `children` replaces the message body for turns that render as a card
 * instead of text (such as an artifact repair handoff); those are not clamped.
 * Styles live in globals.css (`.user-turn*`).
 */
export function UserTurn({
  content,
  children,
  attachments,
  actions,
  deleting = false,
  className = '',
  turnId,
}: {
  content: string;
  children?: ReactNode;
  attachments?: ReactNode;
  actions?: ReactNode;
  deleting?: boolean;
  className?: string;
  turnId?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [overflowing, setOverflowing] = useState(false);
  const custom = children != null;
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return undefined;
    // scrollHeight reports full content height even while max-height clamps
    // the box, so overflow is measurable without expanding first. Re-runs on
    // width changes (sidebar toggle, window resize) via the ResizeObserver.
    const measure = () => setOverflowing(el.scrollHeight > USER_CLAMP_MAX_PX + 8);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [content, custom]);
  const clamped = collapsed && overflowing;
  return (
    <div
      className={`user-turn${deleting ? ' opacity-60 [transition:opacity_var(--dur-hover)_ease]' : ''} ${className}`}
      aria-busy={deleting || undefined}
      data-turn-id={turnId}
      onCopy={trimCopiedSelection}
    >
      <div className="user-turn-inner">
        <div className="user-turn-bubble">
          {custom ? children : (
            <div
              ref={contentRef}
              className={clamped ? 'user-turn-clamp user-turn-clamp--faded' : undefined}
              style={clamped ? { maxHeight: USER_CLAMP_MAX_PX } : undefined}
            >
              {/* The same markdown pipeline as answers, so fences, emphasis and
                  lists typed in the composer render. Forms and charts are off:
                  a special fence typed by the user must not trigger renderers
                  reserved for assistant output. */}
              <MarkdownContent text={content} variant="user" enableForms={false} enableCharts={false} />
            </div>
          )}
          {!custom && overflowing && (
            <button
              type="button"
              className="user-turn-more"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((c) => !c)}
            >
              {collapsed ? 'Show more' : 'Show less'}
            </button>
          )}
        </div>
        {attachments}
        {actions}
      </div>
    </div>
  );
}
