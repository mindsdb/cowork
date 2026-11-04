import { scheduleState } from '../components/schedule/ScheduleStatusBadge';

// Whether the machine should stay awake for scheduled tasks: a run is in
// flight, or a task that runs on its own is due (or overdue) within
// `windowMs`.
//
// A paused task keeps only a run already going: its slots are not coming.
// The window has to cover the gap between polls. The schedule list is
// re-read at most every 10 minutes, so the poll before a due time must
// already hold the machine awake.
export function shouldKeepAwake(schedules, { now = Date.now(), windowMs, enabled = true } = {}) {
  if (!enabled) return false;
  const soon = (iso) => {
    const at = iso ? new Date(iso).getTime() : NaN;
    return Number.isFinite(at) && at - now <= windowMs;
  };
  return (schedules || []).some((s) => {
    if (s.running) return true;
    if (scheduleState(s) !== 'active') return false;
    return soon(s.nextRunAt);
  });
}
