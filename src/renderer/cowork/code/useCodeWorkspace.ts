import { useCallback, useState } from 'react';

import { codingApi, type CodingSession } from './api';

type CodeManagementRoute = 'projects' | 'tasks' | 'connectors' | 'skills' | null;

export function useCodeWorkspace(openCode: () => void) {
  const [sessions, setSessions] = useState<CodingSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [managementRoute, setManagementRoute] = useState<CodeManagementRoute>(null);
  const [tasksProjectId, setTasksProjectId] = useState<string | null>(null);

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

  const openTasks = useCallback((projectId: string | null = null) => {
    setNewTask(false);
    setTasksProjectId(projectId);
    setManagementRoute('tasks');
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

  const setSessionPinned = useCallback(async (sessionId: string, pinned: boolean) => {
    const updated = await codingApi.setPinned(sessionId, pinned);
    setSessions((current) => current.map((session) => (
      session.id === updated.id ? { ...session, pinned: updated.pinned } : session
    )));
  }, []);

  return {
    sessions,
    selectedId,
    newTask,
    managementRoute,
    tasksProjectId,
    tasksOpen: managementRoute === 'tasks',
    projectsOpen: managementRoute === 'projects',
    connectorsOpen: managementRoute === 'connectors',
    skillsOpen: managementRoute === 'skills',
    setSessions,
    openNewTask,
    openProjects,
    openTasks,
    openConnectors,
    openSkills,
    selectSession,
    changeSelection,
    setSessionPinned,
  };
}
