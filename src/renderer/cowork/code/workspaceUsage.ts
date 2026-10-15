import { useEffect, useState } from 'react';

import { codingApi, type WorkspaceUsagePage } from './api';

// While the server is measuring, ask again this often, up to a minute.
const MEASURING_POLL_MS = 2_000;
const MEASURING_POLL_LIMIT = 30;

export const DISK_USAGE_EXPLANATION =
  'Approximate storage Cowork keeps for this task: its workspace, comparison copy and recovery data. '
  + 'Your own folder and the Git history worktrees share are not counted. On macOS copies share disk '
  + 'with their source, so deleting a task can free much less than shown.';

export interface TaskDiskUsage {
  /** Null until the task has been measured. */
  taskBytes: number | null;
  /** The part of ``taskBytes`` kept to recover the task's work. */
  recoveryBytes: number;
  totalBytes: number;
  measuring: boolean;
}

/** A compact size, e.g. "740 MB" or "1.2 GB". */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function taskDiskUsage(page: WorkspaceUsagePage | null, sessionId: string): TaskDiskUsage | null {
  if (!page) return null;
  const item = page.items.find((entry) => entry.session_id === sessionId);
  return {
    taskBytes: item ? item.bytes : null,
    recoveryBytes: item?.recovery_bytes ?? 0,
    totalBytes: page.total_bytes,
    measuring: page.measuring,
  };
}

/** "~1.2 GB (300 MB recovery) · 18 GB across tasks", or why there is no number yet. */
export function diskUsageLabel(usage: TaskDiskUsage | null): string {
  if (!usage || usage.taskBytes === null) return usage?.measuring || !usage ? 'Measuring…' : 'Not measured yet';
  const recovery = usage.recoveryBytes > 0 ? ` (${formatBytes(usage.recoveryBytes)} recovery)` : '';
  const updating = usage.measuring ? ' · updating…' : '';
  return `~${formatBytes(usage.taskBytes)}${recovery} · ${formatBytes(usage.totalBytes)} across tasks${updating}`;
}

/**
 * The server's last storage measurement, asked for again while it is still
 * measuring and whenever ``taskId`` changes. Nothing is shown while ``taskId``
 * is null or the last request failed, so an old number never outlives its task.
 */
export function useWorkspaceUsage(taskId: string | null): WorkspaceUsagePage | null {
  const [page, setPage] = useState<WorkspaceUsagePage | null>(null);
  useEffect(() => {
    if (!taskId) {
      setPage(null);
      return undefined;
    }
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const load = async () => {
      try {
        const next = await codingApi.workspaceUsage(taskId);
        if (!current) return;
        setPage(next);
        if (next.measuring && polls < MEASURING_POLL_LIMIT) {
          polls += 1;
          timer = setTimeout(() => void load(), MEASURING_POLL_MS);
        }
      } catch {
        // A server without the endpoint, or a failed measurement, shows no size.
        if (current) setPage(null);
      }
    };
    void load();
    return () => {
      current = false;
      if (timer) clearTimeout(timer);
    };
  }, [taskId]);
  return page;
}
