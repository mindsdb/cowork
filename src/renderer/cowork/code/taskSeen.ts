import { useCallback, useEffect, useState } from 'react';

import type { CodingSession } from './api';
import { useAppVisible } from './useAppVisible';


const SEEN_KEY = 'cowork:code-task-seen:v1';
const MAX_ENTRIES = 500;

// `baseline` stands in for every task without its own entry, so the first
// run after an upgrade does not mark the whole history unread.
interface SeenState { baseline: string; seen: Record<string, string> }


function readSeen(): SeenState {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SEEN_KEY) || 'null');
    if (stored && typeof stored.baseline === 'string' && stored.seen && typeof stored.seen === 'object') return stored;
  } catch { /* A fresh baseline below is the safe fallback. */ }
  const fresh = { baseline: new Date().toISOString(), seen: {} };
  writeSeen(fresh);
  return fresh;
}


function writeSeen(state: SeenState): void {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(state));
  } catch {
    // Unread markers stay correct for this window when storage is unavailable.
  }
}


function later(left: string, right: string): string {
  return Date.parse(right) > Date.parse(left) ? right : left;
}


/**
 * A finished task is unread until the user has had it open, visible, since
 * its last change. Only a finished build turn qualifies: running and
 * needs-you states already carry their own indicator, and a stop the user
 * asked for is not news.
 */
export function isUnreadTask(session: CodingSession, state: SeenState, selectedId: string | null): boolean {
  if (session.id === selectedId || session.archived) return false;
  if (session.status !== 'completed' || session.task_mode === 'plan') return false;
  const seenAt = state.seen[session.id] || state.baseline;
  return Date.parse(session.updated_at) > Date.parse(seenAt);
}


export function useTaskSeen(sessions: CodingSession[], selectedId: string | null) {
  const [state, setState] = useState(readSeen);
  const visible = useAppVisible();
  const selected = sessions.find((session) => session.id === selectedId);
  const selectedUpdatedAt = selected?.updated_at;

  useEffect(() => {
    if (!selectedId || !selectedUpdatedAt || !visible) return;
    setState((current) => {
      const previous = current.seen[selectedId];
      const seenAt = previous ? later(previous, selectedUpdatedAt) : selectedUpdatedAt;
      if (seenAt === previous) return current;
      const entries = Object.entries({ ...current.seen, [selectedId]: seenAt })
        .sort(([, left], [, right]) => Date.parse(right) - Date.parse(left))
        .slice(0, MAX_ENTRIES);
      const next = { ...current, seen: Object.fromEntries(entries) };
      writeSeen(next);
      return next;
    });
  }, [selectedId, selectedUpdatedAt, visible]);

  return useCallback((session: CodingSession) => isUnreadTask(session, state, selectedId), [selectedId, state]);
}
