import type { CodingEvent, CodingSession, CodingStatus, DiffFile, TaskRunStatus } from './api';


export const CODE_STATUS: Record<CodingStatus, { label: string; tone: 'neutral' | 'accent' | 'warning' | 'success' | 'danger' }> = {
  ready: { label: 'Ready', tone: 'neutral' },
  running: { label: 'Working', tone: 'accent' },
  awaiting_approval: { label: 'Needs approval', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Stopped', tone: 'neutral' },
  interrupted: { label: 'Interrupted', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
};

const RUN_STATUS: Record<TaskRunStatus, { label: string; tone: 'neutral' | 'accent' | 'warning' | 'success' | 'danger' }> = {
  queued: { label: 'Preparing', tone: 'neutral' },
  preparing: { label: 'Preparing', tone: 'accent' },
  ready: { label: 'Ready', tone: 'neutral' },
  running: { label: 'Working', tone: 'accent' },
  awaiting_approval: { label: 'Needs attention', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Stopped', tone: 'neutral' },
  interrupted: { label: 'Resume needed', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  recovering: { label: 'Resuming', tone: 'accent' },
};

export function codingSessionStatus(session: Pick<CodingSession, 'status' | 'run_status' | 'computer_status'>) {
  if (session.computer_status === 'offline' && session.run_status && !['completed', 'cancelled', 'failed'].includes(session.run_status)) {
    return { label: 'Computer offline', tone: 'warning' as const };
  }
  return session.run_status ? RUN_STATUS[session.run_status] : CODE_STATUS[session.status];
}


export function repositoryLabel(session: Pick<CodingSession, 'repository_root' | 'source_path' | 'project_name'>): string {
  if (session.project_name) return session.project_name;
  const path = session.repository_root || session.source_path;
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}


export function compactPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return path;
  const separator = path.includes('\\') ? '\\' : '/';
  return `…${separator}${parts.slice(-3).join(separator)}`;
}


export function relativeTime(raw: string, now = Date.now()): string {
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1_000));
  if (seconds < 45) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d` : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp);
}


export function isActiveStatus(status: CodingStatus): boolean {
  return status === 'running' || status === 'awaiting_approval';
}


export function diffStats(files: Pick<DiffFile, 'additions' | 'deletions'>[]): { additions: number; deletions: number } {
  return files.reduce(
    (totals, file) => ({
      additions: totals.additions + file.additions,
      deletions: totals.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}


export function promptHistory(events: CodingEvent[]): string[] {
  return events
    .filter((event) => event.type === 'user_message' && event.phase === 'completed')
    .map((event) => event.text)
    .reverse()
    .filter((text, index, items) => !!text && items.indexOf(text) === index);
}
