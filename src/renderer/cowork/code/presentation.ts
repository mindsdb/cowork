import i18n, { currentLocale } from '../../lib/i18n';
import type { CodingEvent, CodingSession, CodingStatus, DiffFile, SkillLibraryItem, TaskRunStatus } from './api';


type StatusTone = 'neutral' | 'accent' | 'warning' | 'success' | 'danger';

function t(key: string, values?: Record<string, unknown>): string {
  return i18n.t(key, { ns: 'code', ...values });
}

// The label is read when shown, so it follows the current language.
function status(key: string, tone: StatusTone): { readonly label: string; tone: StatusTone } {
  return { get label() { return t(`presentation.status.${key}`); }, tone };
}

export const CODE_STATUS: Record<CodingStatus, { readonly label: string; tone: StatusTone }> = {
  ready: status('ready', 'neutral'),
  running: status('working', 'accent'),
  awaiting_approval: status('needsApproval', 'warning'),
  completed: status('completed', 'success'),
  cancelled: status('stopped', 'neutral'),
  interrupted: status('interrupted', 'warning'),
  failed: status('failed', 'danger'),
};

const RUN_STATUS: Record<TaskRunStatus, { readonly label: string; tone: StatusTone }> = {
  // A queued run is already on its way, so it reads as work in motion.
  queued: status('preparing', 'accent'),
  preparing: status('preparing', 'accent'),
  ready: status('ready', 'neutral'),
  running: status('working', 'accent'),
  awaiting_approval: status('needsAttention', 'warning'),
  completed: status('completed', 'success'),
  cancelled: status('stopped', 'neutral'),
  interrupted: status('paused', 'warning'),
  failed: status('failed', 'danger'),
  recovering: status('reopening', 'accent'),
};

export function codingSessionStatus(session: Pick<CodingSession, 'status' | 'run_status' | 'computer_status' | 'pending_question' | 'task_mode'>) {
  if (session.computer_status === 'offline' && session.run_status && !['completed', 'cancelled', 'failed'].includes(session.run_status)) {
    return { label: t('presentation.status.computerOffline'), tone: 'warning' as const };
  }
  if (session.pending_question && session.status === 'awaiting_approval') return { label: t('presentation.status.answerNeeded'), tone: 'warning' as const };
  if (session.task_mode === 'plan' && session.status === 'completed') return { label: t('presentation.status.reviewPlan'), tone: 'warning' as const };
  if (session.task_mode === 'plan' && session.status === 'running') return { label: t('presentation.status.planning'), tone: 'accent' as const };
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
  if (seconds < 45) return t('presentation.relative.now');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('presentation.relative.minutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('presentation.relative.hours', { count: hours });
  const days = Math.round(hours / 24);
  return days < 7 ? t('presentation.relative.days', { count: days }) : new Intl.DateTimeFormat(currentLocale(), { month: 'short', day: 'numeric' }).format(timestamp);
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


// A project-scoped catalogue folds a personal or built-in skill under the
// enabled team skill of the same name; the hidden ones arrive in `supersedes`.
export function skillSupersedesHint(item: Pick<SkillLibraryItem, 'supersedes'>): string {
  const hidden = item.supersedes || [];
  return hidden.length ? t('presentation.replaces', { skills: hidden.map((skill) => `${skill.source_name}/${skill.name}`).join(', ') }) : '';
}

export function promptHistory(events: CodingEvent[]): string[] {
  return events
    .filter((event) => event.type === 'user_message' && event.phase === 'completed')
    .map((event) => event.text)
    .reverse()
    .filter((text, index, items) => !!text && items.indexOf(text) === index);
}
