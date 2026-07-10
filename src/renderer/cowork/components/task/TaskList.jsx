// Vertical column of TaskCards. Used by the project view today;
// drop-in for any other "list of conversations" surface.

import { useMemo } from 'react';
import { TaskCard } from './TaskCard';

const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_DISPLAY = "var(--font-display, 'Inter', sans-serif)";

const _ts = (raw) => {
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
};

// Collapse runs of a single schedule into one synthetic task card so
// the project view doesn't render dozens of "this is just a test"
// duplicates from a daily/hourly schedule. Matches the TasksView
// grouping logic.
function groupTasks(tasks, schedules, scheduleRunsIndex) {
  const schedById = new Map((schedules || []).map((s) => [s?.id, s]));
  const resolveSid = (t) => t?.scheduledId || (scheduleRunsIndex || {})[t?.id] || null;
  const out = [];
  const groupsBySchedId = new Map();
  for (const t of tasks || []) {
    const sid = resolveSid(t);
    if (!sid) {
      out.push(t);
      continue;
    }
    let g = groupsBySchedId.get(sid);
    if (!g) {
      const sched = schedById.get(sid);
      const baseTitle = sched?.title || t.title || 'Scheduled task';
      g = {
        // Synthetic task object: every existing call-site passes
        // these via TaskCard so the click flow can branch on
        // `_scheduleGroup` and route to the schedule detail.
        id: `sched:${sid}`,
        title: baseTitle,
        subtitle: t.subtitle,
        updatedAt: t.updatedAt,
        projectName: sched?.project || t.projectName || 'general',
        status: 'idle',
        _scheduleGroup: { scheduleId: sid, runs: 1, baseTitle, latestRun: t },
      };
      groupsBySchedId.set(sid, g);
      out.push(g);
    } else {
      g._scheduleGroup.runs += 1;
      if (_ts(t.updatedAt || t.subtitle) > _ts(g.updatedAt || g.subtitle)) {
        g.subtitle = t.subtitle;
        g.updatedAt = t.updatedAt;
        g._scheduleGroup.latestRun = t;
      }
    }
  }
  return out;
}

export function TaskList({
  tasks = [],
  // Optional title — when present, renders an Inter "Tasks · N"
  // header above the list. Pass null to render just the list.
  title = 'Tasks',
  emptyMessage = 'No tasks yet — start one above.',
  projects = [],
  // Schedule metadata for grouping. Optional — when absent we fall
  // back to a flat list (preserves the old behaviour for callers
  // that haven't been updated).
  schedules = [],
  scheduleRunsIndex = {},
  onSelectTask,
  onOpenSchedule,
  onPinTask,
  onUnpinTask,
  onDeleteTask,
  onMoveTaskToProject,
}) {
  const rows = useMemo(
    () => groupTasks(tasks, schedules, scheduleRunsIndex),
    [tasks, schedules, scheduleRunsIndex],
  );
  return (
    <div>
      {title != null && (
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8,
          marginBottom: 12, paddingLeft: 4,
        }}>
          <span className="s-h3" style={{
            color: 'var(--ink)',
          }}>
            {title}
          </span>
          <span style={{
            fontFamily: FONT_BODY, fontSize: 13, color: 'var(--ink-4)',
          }}>
            {rows.length}
          </span>
        </div>
      )}
      {rows.length === 0 ? (
        <div style={{
          padding: 28,
          fontFamily: FONT_BODY, fontSize: 13, color: 'var(--ink-3)',
          background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 12, textAlign: 'center', lineHeight: 1.55,
        }}>
          {emptyMessage}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((t) => {
            const isGroup = !!t._scheduleGroup;
            return (
              <TaskCard
                key={t.id}
                task={t}
                projects={projects}
                onClick={() => {
                  if (isGroup) {
                    onOpenSchedule?.(t._scheduleGroup.scheduleId);
                  } else {
                    onSelectTask?.(t.id);
                  }
                }}
                onPin={isGroup ? undefined : onPinTask}
                onUnpin={isGroup ? undefined : onUnpinTask}
                onDelete={isGroup ? undefined : onDeleteTask}
                onMoveToProject={isGroup ? undefined : onMoveTaskToProject}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
