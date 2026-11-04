import { useCallback, useEffect, useState, type CSSProperties, type RefObject } from 'react';

import Tooltip from '../ui/Tooltip';

// Below this many user turns a conversation fits in a glance; no map.
export const MINIMAP_MIN_TURNS = 3;
const SNIPPET_CHARS = 120;

export interface MinimapTurn {
  id: string;
  snippet: string;
  // The opening of the turn's answer, when it has one yet.
  answer: string;
  top: number;
}

// Answers in either surface: Cowork's answer turn, Code Mode's agent message.
const ANSWER_SELECTOR = '.answer-turn, .code-agent-message';

/** The answer that closes a turn: the last answer between this user turn and
 *  the next. Code Mode can post progress notes first; the last one is the
 *  reply. Reads the markdown only, not the action row or agent label. */
export function answerAfter(turn: Element): string {
  let answer: Element | null = null;
  for (let el = turn.nextElementSibling; el && !el.matches('[data-turn-id]'); el = el.nextElementSibling) {
    if (el.matches(ANSWER_SELECTOR)) answer = el;
    else answer = el.querySelector(ANSWER_SELECTOR) || answer;
  }
  if (!answer) return '';
  return snippetOf(answer.querySelector('.markdown-content')?.textContent || '');
}

export function snippetOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS - 1).trimEnd()}…` : flat;
}

/** The turn being read: the last one whose top has passed the reading line,
 *  a third of the way down the viewport. Before the first, the first. */
export function activeTurnIndex(tops: number[], scrollTop: number, clientHeight: number): number {
  const line = scrollTop + clientHeight / 3;
  let active = 0;
  tops.forEach((top, i) => { if (top <= line) active = i; });
  return active;
}

// The rail's fit in the margin left of the reading column. It sits INSET_PX
// in, or nearer the edge (down to EDGE_PX) when the margin is tighter, and
// always keeps GAP_PX between its longest tick and the text. Without room for
// that, it hides rather than crowd the conversation.
const REST_PX = 6;
const PEAK_PX = 24;
const INSET_PX = 14;
const EDGE_PX = 6;
const GAP_PX = 24;
// How many ticks either side of the pointer the slope reaches.
const SLOPE_TICKS = 6;

export interface RailFit { inset: number; peak: number }

/** Where the rail goes in a margin of `margin` px, or null when it can't fit. */
export function railFit(margin: number): RailFit | null {
  const inset = Math.min(INSET_PX, margin - PEAK_PX - GAP_PX);
  return inset < EDGE_PX ? null : { inset, peak: PEAK_PX };
}

/** The free margin left of the reading column the turns sit in. */
function marginOf(box: HTMLElement): number {
  const column = box.querySelector('[data-turn-id]')?.closest('.chat-column');
  if (!column) return 0;
  return column.getBoundingClientRect().left - box.getBoundingClientRect().left;
}

function collectTurns(box: HTMLElement): MinimapTurn[] {
  const boxTop = box.getBoundingClientRect().top;
  return Array.from(box.querySelectorAll<HTMLElement>('[data-turn-id]')).map((el) => ({
    id: el.dataset.turnId || '',
    snippet: snippetOf(el.querySelector('.user-turn-bubble')?.textContent || el.textContent || ''),
    answer: answerAfter(el),
    top: el.getBoundingClientRect().top - boxTop + box.scrollTop,
  }));
}

/**
 * A rail of ticks on the transcript's left edge, one per user turn. Hovering
 * a tick shows the start of that prompt and of its answer, as t3code does;
 * clicking it scrolls the turn into view. The tick for the turn being read is highlighted.
 *
 * Reads turns from the DOM (`[data-turn-id]`, set by UserTurn) so neither
 * surface has to pass its message model in. `version` changes whenever the
 * transcript's content may have moved, prompting a re-read.
 */
export function TurnMinimap({
  scrollRef,
  version,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  version: number;
}) {
  const [turns, setTurns] = useState<MinimapTurn[]>([]);
  const [active, setActive] = useState(0);
  // The tick under the pointer; each tick's distance from it sets its length.
  const [pointed, setPointed] = useState<number | null>(null);
  const [fit, setFit] = useState<RailFit | null>(null);

  const refresh = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    const next = collectTurns(box);
    setTurns(next);
    setFit(railFit(marginOf(box)));
    setActive(activeTurnIndex(next.map((t) => t.top), box.scrollTop, box.clientHeight));
  }, [scrollRef]);

  useEffect(() => { refresh(); }, [refresh, version]);

  // Code Mode's column stays 720px wide while its surrounding margin changes.
  // Observe the viewport too: a content resize alone won't refresh that fit.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(refresh);
    observer.observe(box);
    return () => observer.disconnect();
  }, [scrollRef, refresh]);

  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return undefined;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setActive(activeTurnIndex(turnsTops(box), box.scrollTop, box.clientHeight));
      });
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => { box.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [scrollRef]);

  if (turns.length < MINIMAP_MIN_TURNS || !fit) return null;

  const jump = (turn: MinimapTurn) => {
    const box = scrollRef.current;
    if (!box) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({ top: Math.max(0, turn.top - 16), behavior: smooth ? 'smooth' : 'auto' });
  };

  return (
    <nav
      className={`chat-minimap${turns.length > 24 ? ' is-dense' : ''}${pointed != null ? ' is-pointed' : ''}`}
      aria-label="Conversation turns"
      style={{
        '--minimap-inset': `${fit.inset}px`,
        '--minimap-peak': `${fit.peak}px`,
        '--minimap-step': `${(fit.peak - REST_PX) / SLOPE_TICKS}px`,
      } as CSSProperties}
      onPointerLeave={() => setPointed(null)}
    >
      {turns.map((turn, i) => (
        <Tooltip
          key={turn.id || i}
          side="right"
          sideOffset={10}
          delay={0}
          unstyled
          className="chat-minimap__card"
          content={(
            <span className="chat-minimap__preview">
              <span className="chat-minimap__prompt">{turn.snippet || 'Message'}</span>
              {turn.answer && <span className="chat-minimap__answer">{turn.answer}</span>}
            </span>
          )}
        >
          <button
            type="button"
            className={`chat-minimap__tick${i === active ? ' is-active' : ''}`}
            aria-label={`Go to message ${i + 1}: ${turn.snippet}`}
            aria-current={i === active ? 'location' : undefined}
            style={pointed != null ? { '--tick-distance': Math.abs(i - pointed) } as CSSProperties : undefined}
            onPointerEnter={() => setPointed(i)}
            onClick={() => jump(turn)}
          />
        </Tooltip>
      ))}
    </nav>
  );
}

function turnsTops(box: HTMLElement): number[] {
  return collectTurns(box).map((t) => t.top);
}
