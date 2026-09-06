import { useState, useCallback } from 'react';
import {
  fetchSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  pauseSchedule,
  resumeSchedule,
} from '../api';

// Manage schedule data and its session-to-schedule index.
// Cross-domain polling, navigation and Run now remain in App.jsx.
export function useSchedules() {
  const [scheduled, setScheduled] = useState([]);
  // Flat session→schedule map sourced from `GET /v1/schedules`.
  // Lets TasksView collapse all conversations belonging to one
  // schedule into a single grouped row instead of listing each
  // execution separately.
  const [scheduleRunsIndex, setScheduleRunsIndex] = useState({});

  const refreshSchedules = useCallback(async () => {
    const data = await fetchSchedules();
    const list = data.schedules || [];
    setScheduled(list);
    setScheduleRunsIndex(data.runs_index || {});
    return list;
  }, []);

  const handleCreateSchedule = async (payload) => {
    await createSchedule(payload);
    await refreshSchedules();
  };

  const handleUpdateSchedule = async (id, payload) => {
    await updateSchedule(id, payload);
    await refreshSchedules();
  };

  const handleDeleteSchedule = async (id) => {
    await deleteSchedule(id);
    await refreshSchedules();
  };

  const handlePauseSchedule = async (id) => {
    await pauseSchedule(id);
    await refreshSchedules();
  };

  const handleResumeSchedule = async (id) => {
    await resumeSchedule(id);
    await refreshSchedules();
  };

  return {
    scheduled,
    scheduleRunsIndex,
    refreshSchedules,
    handleCreateSchedule,
    handleUpdateSchedule,
    handleDeleteSchedule,
    handlePauseSchedule,
    handleResumeSchedule,
  };
}
