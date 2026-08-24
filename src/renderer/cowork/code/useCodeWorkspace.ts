import { useCallback, useState } from 'react';

import type { CodingSession } from './api';

type CodeManagementRoute = 'projects' | 'connectors' | 'skills' | null;

export function useCodeWorkspace(openCode: () => void) {
  const [sessions, setSessions] = useState<CodingSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [managementRoute, setManagementRoute] = useState<CodeManagementRoute>(null);

  const openNewTask = useCallback(() => {
    setNewTask(true);
    setManagementRoute(null);
    openCode();
  }, [openCode]);

  const openProjects = useCallback(() => {
    setNewTask(false);
    setManagementRoute('projects');
    openCode();
  }, [openCode]);

  const openConnectors = useCallback(() => {
    setNewTask(false);
    setManagementRoute('connectors');
    openCode();
  }, [openCode]);

  const openSkills = useCallback(() => {
    setNewTask(false);
    setManagementRoute('skills');
    openCode();
  }, [openCode]);

  const selectSession = useCallback((sessionId: string) => {
    setSelectedId(sessionId);
    setNewTask(false);
    setManagementRoute(null);
    openCode();
  }, [openCode]);

  const changeSelection = useCallback((sessionId: string | null, isNewTask = false) => {
    setSelectedId(sessionId);
    setNewTask(isNewTask);
    setManagementRoute(null);
  }, []);

  return {
    sessions,
    selectedId,
    newTask,
    projectsOpen: managementRoute === 'projects',
    connectorsOpen: managementRoute === 'connectors',
    skillsOpen: managementRoute === 'skills',
    setSessions,
    openNewTask,
    openProjects,
    openConnectors,
    openSkills,
    selectSession,
    changeSelection,
  };
}
