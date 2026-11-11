import { useEffect, useState } from 'react';

import { codingApi, type WorkspaceUsagePage } from './api';
import i18n from '../../lib/i18n';

// While the server is measuring, ask again every 2 seconds for the first
// minute, then back off to every 30 seconds. A large workspace can take longer
// than a minute to walk, so polling never stops while the server is measuring.
const MEASURING_POLL_MS = 2_000;
const MEASURING_FAST_POLLS = 30;
const MEASURING_SLOW_POLL_MS = 30_000;

export function measuringPollDelay(polls: number): number {
  if (polls < MEASURING_FAST_POLLS) return MEASURING_POLL_MS;
  return Math.min(MEASURING_POLL_MS * 2 ** (polls - MEASURING_FAST_POLLS + 1), MEASURING_SLOW_POLL_MS);
}

/** Tooltip explaining what the disk-usage figure counts, in the current language. */
export function diskUsageExplanation(): string {
  return i18n.t('workspaceUsage.explanation', { ns: 'code' });
}

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

export interface DiskUsageRow {
  label: string;
  value: string;
}

/**
 * The task details rows for storage, one value each so none is cut off in
 * the narrow details column: the task's size, the part kept for recovery
 * when there is one, and the total across tasks. Before the task has a
 * size, one row says why.
 */
export function diskUsageRows(usage: TaskDiskUsage | null): DiskUsageRow[] {
  if (!usage || usage.taskBytes === null) {
    return [{
      label: i18n.t('workspaceUsage.storage', { ns: 'code' }),
      value: usage?.measuring || !usage ? i18n.t('workspaceUsage.measuring', { ns: 'code' }) : i18n.t('workspaceUsage.notMeasured', { ns: 'code' }),
    }];
  }
  const size = formatBytes(usage.taskBytes);
  return [
    {
      label: i18n.t('workspaceUsage.storage', { ns: 'code' }),
      value: usage.measuring ? i18n.t('workspaceUsage.taskSizeUpdating', { ns: 'code', size }) : i18n.t('workspaceUsage.taskSize', { ns: 'code', size }),
    },
    ...(usage.recoveryBytes > 0 ? [{
      label: i18n.t('workspaceUsage.recovery', { ns: 'code' }),
      value: i18n.t('workspaceUsage.recoveryOfThat', { ns: 'code', size: formatBytes(usage.recoveryBytes) }),
    }] : []),
    { label: i18n.t('workspaceUsage.allTasks', { ns: 'code' }), value: formatBytes(usage.totalBytes) },
  ];
}

/**
 * The server's last storage measurement, asked for again while it is still
 * measuring and whenever ``taskId`` or ``workspacePath`` changes. A new task's
 * workspace path is empty until its workspace is ready, so a size measured
 * while it was still preparing is replaced once it is. Nothing is shown while
 * ``taskId`` is null or the last request failed, so an old number never
 * outlives its task.
 */
export function useWorkspaceUsage(taskId: string | null, workspacePath = ''): WorkspaceUsagePage | null {
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
        if (next.measuring) {
          timer = setTimeout(() => void load(), measuringPollDelay(polls));
          polls += 1;
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
  }, [taskId, workspacePath]);
  return page;
}
