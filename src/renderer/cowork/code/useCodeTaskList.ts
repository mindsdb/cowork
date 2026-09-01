import { useCallback, useEffect, useRef, useState } from 'react';
import { codingApi, type CodingSession } from './api';


function sidebarProjectionChanged(previous: CodingSession, next: CodingSession): boolean {
  return previous.title !== next.title
    || previous.status !== next.status
    || previous.run_status !== next.run_status
    || previous.computer_status !== next.computer_status
    || previous.project_name !== next.project_name
    || previous.repository_root !== next.repository_root
    || previous.source_path !== next.source_path
    || previous.pinned !== next.pinned
    || previous.archived !== next.archived;
}


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

  const load = useCallback(async (preferId?: string) => {
    const page = await codingApi.sessions(true);
    setError('');
    onSessionsChangeRef.current(page.items);
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

  useEffect(() => {
    if (!active) return undefined;
    load()
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load coding tasks.'))
      .finally(() => setLoading(false));
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      load().catch(() => {
        // The selected-task stream owns connectivity feedback during a
        // transient background-list refresh.
      });
    };
    const interval = window.setInterval(refresh, 5_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
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

  return { loading, error, load };
}
