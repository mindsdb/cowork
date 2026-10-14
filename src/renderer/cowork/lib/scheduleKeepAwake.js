// Whether the machine should stay awake for scheduled tasks: a run is in
// flight, or an enabled schedule is due (or overdue) within `windowMs`.
//
// The window has to cover the gap between polls. The schedule list is
// re-read at most every 10 minutes and about a minute after a run comes due,
// so the poll before a due time must already hold the machine awake.
export function shouldKeepAwake(schedules, { now = Date.now(), windowMs } = {}) {
  return (schedules || []).some((s) => {
    if (s.running) return true;
    if (!s.enabled || !s.nextRunAt) return false;
    const due = new Date(s.nextRunAt).getTime();
    return Number.isFinite(due) && due - now <= windowMs;
  });
}
