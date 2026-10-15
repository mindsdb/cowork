import { scheduleState } from '../components/schedule/ScheduleStatusBadge';

// Whether the machine should stay awake for scheduled tasks: a run is in
// flight, or a task that runs on its own is due (or overdue) within
// `windowMs`, either its next slot or a failed run's retry.
//
// A paused task keeps only a run already going: its slots and retries are
// not coming. The window has to cover the gap between polls. The schedule
// list is re-read at most every 10 minutes, and every minute while a retry
// waits, so the poll before a due time must already hold the machine awake.
export function shouldKeepAwake(schedules, { now = Date.now(), windowMs, enabled = true } = {}) {
  if (!enabled) return false;
  const soon = (iso) => {
    const at = iso ? new Date(iso).getTime() : NaN;
    return Number.isFinite(at) && at - now <= windowMs;
  };
  return (schedules || []).some((s) => {
    if (s.running) return true;
    if (scheduleState(s) !== 'active') {
      // A one-off is disabled by its own claim; its retry still runs.
      return scheduleState(s) === 'done' && soon(s.retryAt);
    }
    return soon(s.nextRunAt) || soon(s.retryAt);
  });
}
