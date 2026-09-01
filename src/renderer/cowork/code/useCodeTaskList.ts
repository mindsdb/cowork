import { useCallback, useEffect, useRef, useState } from 'react';
import { codingApi, type CodingSession } from './api';


export function useCodeTaskList({
  sessions,
  selectedId,
  newTask,
  currentSession,
  onSessionsChange,
  onSelectionChange,
}: {
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
    if (!page.items.length && !preferId) {
      onSelectionChangeRef.current(null, true);
    } else if (preferId || (!newTaskRef.current && !currentExists)) {
      onSelectionChangeRef.current(nextId, false);
    }
    return page.items;
  }, []);

  useEffect(() => {
    load()
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load coding tasks.'))
      .finally(() => setLoading(false));
    const interval = window.setInterval(() => {
      load().catch(() => {
        // The selected-task stream owns connectivity feedback during a
        // transient background-list refresh.
      });
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!currentSession) return;
    onSessionsChangeRef.current(
      sessionsRef.current.map((item) => item.id === currentSession.id ? currentSession : item),
    );
  }, [currentSession]);

  return { loading, error, load };
}
