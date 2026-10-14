import { useCallback, useRef, useState } from 'react';

import { codingApi, type CodingSession } from './api';

type CodeManagementRoute = 'projects' | 'tasks' | 'connectors' | 'skills' | null;

export function useCodeWorkspace(openCode: () => void) {
  const [sessions, setSessions] = useState<CodingSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [managementRoute, setManagementRoute] = useState<CodeManagementRoute>(null);
  const [tasksProjectId, setTasksProjectId] = useState<string | null>(null);
  // Row actions settle after the list may have polled or the selection moved.
  const latest = useRef({ sessions, selectedId, managementRoute });
  latest.current = { sessions, selectedId, managementRoute };

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

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    const updated = await codingApi.renameSession(sessionId, title);
    setSessions((current) => current.map((session) => (
      session.id === updated.id ? { ...session, title: updated.title } : session
    )));
  }, []);

  // Archiving or deleting the open task moves you to the next active one, or
  // to a new task when none is left, as the task's own header used to.
  const leaveSession = useCallback((sessionId: string, remaining: CodingSession[]) => {
    if (latest.current.selectedId !== sessionId) return;
    const next = remaining.find((session) => !session.archived && session.id !== sessionId);
    setSelectedId(next?.id || null);
    // A management page stays where it is; only the task view needs a fallback.
    if (!latest.current.managementRoute) setNewTask(!next);
  }, []);

  const setSessionArchived = useCallback(async (sessionId: string, archived: boolean) => {
    const updated = await codingApi.setArchived(sessionId, archived);
    const next = latest.current.sessions.map((session) => (
      session.id === updated.id ? { ...session, archived: updated.archived } : session
    ));
    setSessions(next);
    if (archived) leaveSession(sessionId, next);
  }, [leaveSession]);

  const deleteSession = useCallback(async (sessionId: string) => {
    await codingApi.deleteSession(sessionId);
    const next = latest.current.sessions.filter((session) => session.id !== sessionId);
    setSessions(next);
    leaveSession(sessionId, next);
  }, [leaveSession]);

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
    renameSession,
    setSessionArchived,
    deleteSession,
  };
}
