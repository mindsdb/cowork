// Data loading — tasks, projects, artifacts, scheduled, pins, connectors.
//
// Ported from anton-cowork's useDataLoader hook, extended with antontron's
// connectors (datasources) fetching.

import { useState, useCallback, useEffect } from 'react';
import {
  fetchSessions, fetchProjects, fetchArtifacts,
  fetchPins, fetchSchedules, fetchDatasources,
} from '../api';
import { mergeTasksFromServer } from './useConversationTurns';

export default function useDataLoader(loadSettings) {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [pins, setPins] = useState([]);
  const [connectors, setConnectors] = useState([]);

  const refreshData = useCallback(() => {
    loadSettings();
    fetchSessions().then((data) => { if (Array.isArray(data)) setTasks((prev) => mergeTasksFromServer(data, prev)); });
    fetchProjects().then((data) => { if (Array.isArray(data)) setProjects(data); });
    fetchArtifacts().then((data) => { if (Array.isArray(data)) setArtifacts(data); });
    fetchPins().then((data) => setPins(data.pins || []));
    fetchSchedules().then((data) => setScheduled(data.schedules || []));
    fetchDatasources()
      .then((data) => setConnectors(Array.isArray(data?.connections) ? data.connections : []))
      .catch(() => setConnectors([]));
  }, [loadSettings]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const refreshArtifacts = useCallback(async () => {
    const data = await fetchArtifacts();
    if (Array.isArray(data)) setArtifacts(data);
  }, []);

  const refreshProjects = useCallback(async () => {
    const data = await fetchProjects();
    if (Array.isArray(data)) setProjects(data);
    return data;
  }, []);

  const refreshPins = useCallback(async () => {
    const data = await fetchPins();
    setPins(data.pins || []);
  }, []);

  const refreshSessions = useCallback(async () => {
    const data = await fetchSessions();
    if (Array.isArray(data)) setTasks((prev) => mergeTasksFromServer(data, prev));
  }, []);

  const refreshSchedules = useCallback(async () => {
    const data = await fetchSchedules();
    setScheduled(data.schedules || []);
  }, []);

  return {
    tasks, setTasks,
    projects, setProjects,
    artifacts,
    scheduled,
    pins, setPins,
    connectors, setConnectors,
    refreshData,
    refreshArtifacts,
    refreshProjects,
    refreshPins,
    refreshSessions,
    refreshSchedules,
  };
}
