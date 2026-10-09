// A project's tasks: the shared task rows, minus the project in the meta.

import { useMemo } from 'react';
import { CollectionState, ListGroup } from '../collection';
import { TaskRow, ScheduleGroupRow, chatTaskMenu, chatTaskRow, groupScheduleRuns } from './TaskRows';

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
              return (
                <TaskRow
                  key={row.task.id}
                  {...chatTaskRow(row.task)}
                  onOpen={() => onSelectTask?.(row.task.id)}
                  menuItems={chatTaskMenu(row.task, { onMoveToProject: onMoveTaskToProject, onDelete: onDeleteTask })}
                />
              );
            }
            return (
              <ScheduleGroupRow
                key={`sched:${row.scheduledId}`}
                schedule={schedulesById.get(row.scheduledId)}
                runs={row.runs}
                onOpenSchedule={() => onOpenSchedule?.(row.scheduledId)}
                onOpenTask={onSelectTask}
              />
            );
          })}
        </ListGroup>
      </CollectionState>
    </div>
  );
}
