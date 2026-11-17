// Which schedule a task is a run of, so every list can fold a schedule's runs
// into one row. The conversation's own `scheduledId` is the answer when the
// server sends it. A server that does not send it (an older one, or a lookup
// that missed) would otherwise list every run as its own task, so the
// schedules list fills the gap:
//
//   1. `scheduledId` on the task.
//   2. A schedule that names the task's conversation as its latest result
//      (`lastResultConversationId`, or `lastRun.conversationId`). Exact, but
//      it only knows each schedule's newest run.
//   3. A weaker match for the older runs: a run's conversation is named after
//      its schedule and lives in the schedule's project, so a task whose title
//      and project match exactly one schedule, and that was created no earlier
//      than the schedule, is taken as one of its runs. A chat the user gave the
//      same name in the same project after making the schedule would fold too;
//      that trade is accepted to keep a busy schedule from flooding the list.

// The server cuts a run's conversation title to the width of its column.
const RUN_TITLE_MAX_LENGTH = 255;

const time = (raw) => {
  if (!raw) return null;
  const t = typeof raw === 'number' ? raw : Date.parse(raw);
  return Number.isFinite(t) ? t : null;
};

const titleKey = (projectId, title) => `${projectId}\u0000${title}`;

/**
 * Builds a resolver from the schedules list.
 * @param {Array<object>} schedules
 * @returns {(task: object) => string | null} the schedule id the task is a run of
 */
export function scheduleRunResolver(schedules) {
  const byConversation = new Map();
  // titleKey → schedule, or null when two schedules share the key.
  const byTitle = new Map();
  for (const s of schedules || []) {
    if (!s?.id) continue;
    for (const conv of [s.lastResultConversationId, s.lastRun?.conversationId]) {
      if (conv) byConversation.set(String(conv), s.id);
    }
    if (s.projectId && s.title) {
      const key = titleKey(s.projectId, s.title.slice(0, RUN_TITLE_MAX_LENGTH));
      byTitle.set(key, byTitle.has(key) ? null : s);
    }
  }

  return (task) => {
    if (!task) return null;
    if (task.scheduledId) return task.scheduledId;
    const exact = task.id != null ? byConversation.get(String(task.id)) : undefined;
    if (exact) return exact;
    if (!task.projectId || !task.title) return null;
    const sched = byTitle.get(titleKey(task.projectId, task.title));
    if (!sched) return null;
    // A chat that existed before the schedule cannot be one of its runs.
    const createdAt = time(task.createdAt);
    const schedCreatedAt = time(sched.createdAt);
    if (createdAt != null && schedCreatedAt != null && createdAt < schedCreatedAt) return null;
    return sched.id;
  };
}
