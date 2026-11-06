import { useCallback, useEffect, useRef, useState } from 'react';
import { codingApi, type CodingSession } from './api';
import { isAppVisible, subscribeAppVisibility } from './useAppVisible';


function sidebarProjectionChanged(previous: CodingSession, next: CodingSession): boolean {
  return previous.title !== next.title
    || previous.status !== next.status
    || previous.task_mode !== next.task_mode
    || previous.pending_question?.id !== next.pending_question?.id
    || previous.run_status !== next.run_status
    || previous.computer_status !== next.computer_status
    || previous.project_name !== next.project_name
    || previous.repository_root !== next.repository_root
    || previous.source_path !== next.source_path
    || previous.pinned !== next.pinned
    || previous.archived !== next.archived;
}


function sessionListChanged(previous: CodingSession[], next: CodingSession[]): boolean {
  if (previous.length !== next.length) return true;
  return next.some((session, index) => {
    const previousSession = previous[index];
    return !previousSession || JSON.stringify(previousSession) !== JSON.stringify(session);
  });
}


// Background polls skip archived tasks, which cost the server a full control
// view each and rarely change; the known archived rows are carried over in the
// server's newest-first order. Returns null when a previously active task is
// gone from the page (archived or deleted elsewhere), since only a full list
// can say which.
export function withKnownArchived(active: CodingSession[], previous: CodingSession[]): CodingSession[] | null {
  const activeIds = new Set(active.map((item) => item.id));
  if (previous.some((item) => !item.archived && !activeIds.has(item.id))) return null;
  const archived = previous.filter((item) => item.archived && !activeIds.has(item.id));
  if (!archived.length) return active;
  return [...active, ...archived].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

// Every sixth poll (30s) still fetches the full list so archived rows stay fresh.
const FULL_REFRESH_EVERY = 6;


export function useCodeTaskList({
  active = true,
  sessions,
  selectedId,
  newTask,
  currentSession,
  onSessionsChange,
  onSelectionChange,
}: {
  active?: boolean;
  sessions: CodingSession[];
  selectedId: string | null;
  newTask: boolean;
  currentSession: CodingSession | null;
  onSessionsChange: (sessions: CodingSession[]) => void;
  onSelectionChange: (sessionId: string | null, newTask?: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const selectedIdRef = useRef(selectedId);
  const newTaskRef = useRef(newTask);
  const sessionsRef = useRef(sessions);
  const onSessionsChangeRef = useRef(onSessionsChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  selectedIdRef.current = selectedId;
  newTaskRef.current = newTask;
  sessionsRef.current = sessions;
  onSessionsChangeRef.current = onSessionsChange;
  onSelectionChangeRef.current = onSelectionChange;

  const load = useCallback(async (preferId?: string, activeOnly = false) => {
    let items: CodingSession[] | null = null;
    if (activeOnly) {
      items = withKnownArchived((await codingApi.sessions(false)).items, sessionsRef.current);
    }
    const page = { items: items ?? (await codingApi.sessions(true)).items };
    setError('');
    // Polling returns fresh object identities even when no task changed. Keep
    // the existing list in that common case so large histories do not force a
    // full Code surface render every five seconds.
    if (sessionListChanged(sessionsRef.current, page.items)) {
      onSessionsChangeRef.current(page.items);
    }
    const currentId = selectedIdRef.current;
    const currentExists = !!currentId && page.items.some((item) => item.id === currentId);
    const firstVisible = page.items.find((item) => !item.archived)?.id || page.items[0]?.id;
    const nextId = preferId || (currentExists ? currentId : firstVisible) || null;
    if (!page.items.length && !preferId && !newTaskRef.current) {
      onSelectionChangeRef.current(null, true);
    } else if (preferId || (!newTaskRef.current && !currentExists)) {
      onSelectionChangeRef.current(nextId, false);
    }
    return page.items;
  }, []);

  const retry = useCallback(async () => {
    setLoading(true);
    try {
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load coding tasks.');
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (!active) return undefined;
    load()
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load coding tasks.'))
      .finally(() => setLoading(false));
    let polls = 0;
    const refresh = (activeOnly = false) => {
      if (!isAppVisible()) return;
      load(undefined, activeOnly).catch(() => {
        // The selected-task stream owns connectivity feedback during a
        // transient background-list refresh.
      });
    };
    const interval = window.setInterval(() => {
      polls = (polls + 1) % FULL_REFRESH_EVERY;
      refresh(polls !== 0);
    }, 5_000);
    const unsubscribeVisibility = subscribeAppVisibility(() => refresh());
    return () => {
      window.clearInterval(interval);
      unsubscribeVisibility();
    };
  }, [active, load]);

  useEffect(() => {
    if (!currentSession) return;
    const previous = sessionsRef.current.find((item) => item.id === currentSession.id);
    // The task list already refreshes every five seconds. Do not rebuild the
    // whole sidebar for event_count/checkpoint/updated_at changes arriving at
    // stream cadence; only session fields which change its visible state need
    // an immediate projection.
    if (previous && !sidebarProjectionChanged(previous, currentSession)) return;
    onSessionsChangeRef.current(
      sessionsRef.current.map((item) => item.id === currentSession.id ? currentSession : item),
    );
  }, [currentSession]);

  return { loading, error, load, retry };
}
