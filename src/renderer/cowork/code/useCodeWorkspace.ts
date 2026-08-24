import { useCallback, useState } from 'react';

import type { CodingSession } from './api';


export function useCodeWorkspace(openCode: () => void) {
  const [sessions, setSessions] = useState<CodingSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);

  const openNewTask = useCallback(() => {
    setNewTask(true);
    setProjectsOpen(false);
    openCode();
  }, [openCode]);

  const openProjects = useCallback(() => {
    setNewTask(false);
    setProjectsOpen(true);
    openCode();
  }, [openCode]);

  const selectSession = useCallback((sessionId: string) => {
    setSelectedId(sessionId);
    setNewTask(false);
    setProjectsOpen(false);
    openCode();
  }, [openCode]);

  const changeSelection = useCallback((sessionId: string | null, isNewTask = false) => {
    setSelectedId(sessionId);
    setNewTask(isNewTask);
    setProjectsOpen(false);
  }, []);

  return {
    sessions,
    selectedId,
    newTask,
    projectsOpen,
    setSessions,
    openNewTask,
    openProjects,
    selectSession,
    changeSelection,
  };
}
