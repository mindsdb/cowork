import { useCallback, useState } from 'react';

import type { CodingSession } from './api';


export function useCodeWorkspace(openCode: () => void) {
  const [sessions, setSessions] = useState<CodingSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState(false);

  const openNewTask = useCallback(() => {
    setNewTask(true);
    openCode();
  }, [openCode]);

  const selectSession = useCallback((sessionId: string) => {
    setSelectedId(sessionId);
    setNewTask(false);
    openCode();
  }, [openCode]);

  const changeSelection = useCallback((sessionId: string | null, isNewTask = false) => {
    setSelectedId(sessionId);
    setNewTask(isNewTask);
  }, []);

  return {
    sessions,
    selectedId,
    newTask,
    setSessions,
    openNewTask,
    selectSession,
    changeSelection,
  };
}
