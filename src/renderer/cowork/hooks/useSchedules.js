import { useState, useCallback } from 'react';
import {
  fetchSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  pauseSchedule,
  resumeSchedule,
} from '../api';

// Scheduled-task data and its CRUD lifecycle: the schedule list, a refresh
// that writes it, and the create/update/delete/pause/resume handlers (each refreshes so the list
// reflects the server immediately).
//
// Deliberately scoped to schedule *data*. Three schedule-adjacent things
// stay in App.jsx because they cross into other domains:
//   - the self-adjusting poll effect (it also syncs newly-produced
//     conversations into the task list)
//   - `selectedScheduleId` (schedule-detail navigation state, set alongside
//     the router in several places)
//   - `handleRunScheduleNow` (navigates to the new run and refreshes the app)
export function useSchedules() {
  // Which conversations are a schedule's runs comes with each conversation
  // (`scheduledId`), not with this list, so the list stays the same size
  // however long a schedule's history.
  const [scheduled, setScheduled] = useState([]);

  const refreshSchedules = useCallback(async () => {
    const data = await fetchSchedules();
    const list = data.schedules || [];
    setScheduled(list);
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
    refreshSchedules,
    handleCreateSchedule,
    handleUpdateSchedule,
    handleDeleteSchedule,
    handlePauseSchedule,
    handleResumeSchedule,
  };
}
