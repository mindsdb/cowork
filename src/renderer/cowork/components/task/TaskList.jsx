// A project's tasks, as collection-kit rows. Same rows as the all-tasks page,
// minus the project in the meta, and a menu that can move a task out.

import { useMemo } from 'react';
import Ico from '../Icons';
import { OverflowMenu } from '../OverflowMenu';
import { CollectionState, ListGroup } from '../collection';
import { TaskRow, ScheduleGroupRow, groupScheduleRuns, latestRun } from './TaskRows';

export function TaskList({
  tasks = [],
  schedules = [],
  scheduleRunsIndex = {},
  onSelectTask,
  onOpenSchedule,
  onDeleteTask,
  onMoveTaskToProject,
}) {
  const rows = useMemo(
    () => groupScheduleRuns(tasks, scheduleRunsIndex),
    [tasks, scheduleRunsIndex],
  );
  const schedulesById = useMemo(
    () => new Map((schedules || []).map((s) => [s?.id, s])),
    [schedules],
  );

  const menuItems = (task) => [
    onMoveTaskToProject && { id: 'move', icon: Ico.moveTo(14), label: 'Move to project…', onClick: () => onMoveTaskToProject(task) },
    onMoveTaskToProject && onDeleteTask && { divider: true },
    onDeleteTask && { id: 'delete', icon: Ico.trash(14), label: 'Delete', danger: true, onClick: () => onDeleteTask(task.id) },
  ].filter(Boolean);

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3 pl-1">
        <span className="s-h3">Tasks</span>
        <span className="font-body text-[13px] text-ink-4">{rows.length}</span>
      </div>
      <CollectionState
        total={rows.length}
        shown={rows.length}
        empty={{ bordered: true, title: 'No tasks in this project yet', description: 'Type a prompt above to start one.' }}
      >
        <ListGroup>
          {rows.map((row) => {
            if (row.kind === 'task') {
              const items = menuItems(row.task);
              return (
                <TaskRow
                  key={row.task.id}
                  task={row.task}
                  onOpen={(task) => onSelectTask?.(task.id)}
                  actions={items.length ? <OverflowMenu size="sm" label="Task menu" items={items} /> : undefined}
                />
              );
            }
            return (
              <ScheduleGroupRow
                key={`sched:${row.scheduledId}`}
                schedule={schedulesById.get(row.scheduledId)}
                runs={row.runs}
                onOpenSchedule={() => onOpenSchedule?.(row.scheduledId)}
                onOpenLatest={() => {
                  const latest = latestRun(row.runs);
                  if (latest?.id) onSelectTask?.(latest.id);
                }}
              />
            );
          })}
        </ListGroup>
      </CollectionState>
    </div>
  );
}
