import { useEffect, useState } from 'react';

import { codingApi, type WorkspaceUsagePage } from './api';

// While the server is measuring, ask again this often, up to a minute.
const MEASURING_POLL_MS = 2_000;
const MEASURING_POLL_LIMIT = 30;

export interface TaskDiskUsage {
  /** Null until the task has been measured. */
  taskBytes: number | null;
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
  return { taskBytes: item ? item.bytes : null, totalBytes: page.total_bytes, measuring: page.measuring };
}

/** "~1.2 GB · 18 GB across tasks", or why there is no number yet. */
export function diskUsageLabel(usage: TaskDiskUsage | null): string {
  if (!usage || usage.taskBytes === null) return usage?.measuring || !usage ? 'Measuring…' : 'Not measured yet';
  return `~${formatBytes(usage.taskBytes)} · ${formatBytes(usage.totalBytes)} across tasks`;
}

/**
 * The server's last workspace measurement, asked for again while it is still
 * measuring and whenever ``taskId`` changes; nothing is fetched while it is null.
 */
export function useWorkspaceUsage(taskId: string | null): WorkspaceUsagePage | null {
  const [page, setPage] = useState<WorkspaceUsagePage | null>(null);
  useEffect(() => {
    if (!taskId) return undefined;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const load = async () => {
      try {
        const next = await codingApi.workspaceUsage();
        if (!current) return;
        setPage(next);
        if (next.measuring && polls < MEASURING_POLL_LIMIT) {
          polls += 1;
          timer = setTimeout(() => void load(), MEASURING_POLL_MS);
        }
      } catch { /* A server without the endpoint simply shows no size. */ }
    };
    void load();
    return () => {
      current = false;
      if (timer) clearTimeout(timer);
    };
  }, [taskId]);
  return page;
}
