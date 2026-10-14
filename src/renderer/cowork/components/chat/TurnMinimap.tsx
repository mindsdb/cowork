import { useCallback, useEffect, useState, type RefObject } from 'react';

import Tooltip from '../ui/Tooltip';

// Below this many user turns a conversation fits in a glance; no map.
export const MINIMAP_MIN_TURNS = 3;
const SNIPPET_CHARS = 120;

export interface MinimapTurn {
  id: string;
  snippet: string;
  top: number;
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

function collectTurns(box: HTMLElement): MinimapTurn[] {
  const boxTop = box.getBoundingClientRect().top;
  return Array.from(box.querySelectorAll<HTMLElement>('[data-turn-id]')).map((el) => ({
    id: el.dataset.turnId || '',
    snippet: snippetOf(el.querySelector('.user-turn-bubble')?.textContent || el.textContent || ''),
    top: el.getBoundingClientRect().top - boxTop + box.scrollTop,
  }));
}

/**
 * A rail of ticks on the transcript's left edge, one per user turn. Hovering
 * a tick shows the start of that prompt; clicking it scrolls the turn into
 * view. The tick for the turn being read is highlighted.
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

  const refresh = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    const next = collectTurns(box);
    setTurns(next);
    setActive(activeTurnIndex(next.map((t) => t.top), box.scrollTop, box.clientHeight));
  }, [scrollRef]);

  useEffect(() => { refresh(); }, [refresh, version]);

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

  if (turns.length < MINIMAP_MIN_TURNS) return null;

  const jump = (turn: MinimapTurn) => {
    const box = scrollRef.current;
    if (!box) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({ top: Math.max(0, turn.top - 16), behavior: smooth ? 'smooth' : 'auto' });
  };

  return (
    <nav className={`chat-minimap${turns.length > 24 ? ' is-dense' : ''}`} aria-label="Conversation turns">
      {turns.map((turn, i) => (
        <Tooltip key={turn.id || i} content={turn.snippet || 'Message'} side="right">
          <button
            type="button"
            className={`chat-minimap__tick${i === active ? ' is-active' : ''}`}
            aria-label={`Go to message ${i + 1}: ${turn.snippet}`}
            aria-current={i === active ? 'location' : undefined}
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
