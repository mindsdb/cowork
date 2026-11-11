// Whether the machine should stay awake for scheduled tasks: a run is in
// flight, or a task that runs on its own is due (or overdue) within
// `windowMs`.
//
// A paused task keeps only a run already going: its slots are not coming.
// The window has to cover the gap between polls. The schedule list is
// re-read at most every 10 minutes, so the poll before a due time must
// already hold the machine awake.
// A task that repeats more often than that window plus a run is always about
// to run: between its runs the next one is up to a full interval away, and a
// release there would let the machine sleep through it. So its window is its
// whole interval, and it holds the machine awake for as long as it's active.
// A server without M0 sends no `state`; its paused and finished tasks are
// the ones with `enabled` off.
const runsOnItsOwn = (s) => (s.state ? s.state === 'active' : !!s.enabled);

const SHORT_CADENCE_MS = {
  every_15_minutes: 15 * 60 * 1000,
  every_30_minutes: 30 * 60 * 1000,
};

export function shouldKeepAwake(schedules, { now = Date.now(), windowMs, enabled = true } = {}) {
  if (!enabled) return false;
  const soon = (iso, within) => {
    const at = iso ? new Date(iso).getTime() : NaN;
    return Number.isFinite(at) && at - now <= within;
  };
  return (schedules || []).some((s) => {
    if (s.running) return true;
    if (!runsOnItsOwn(s)) return false;
    return soon(s.nextRunAt, Math.max(windowMs, SHORT_CADENCE_MS[s.cadence] ?? 0));
  });
}
