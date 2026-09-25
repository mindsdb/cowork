import type { CodingSession } from './api';

export function taskAttention(session: CodingSession): { key: string; message: string } | null {
  if (session.archived) return null;
  if (session.pending_question) return { key: `question:${session.pending_question.id}`, message: 'A task needs your answer.' };
  if (session.pending_approval) return { key: `approval:${session.pending_approval.id}`, message: 'A task needs your approval.' };
  if (session.task_mode === 'plan' && session.status === 'completed') return { key: 'plan', message: 'A plan is ready for your review.' };
  if (session.status === 'failed' || session.status === 'interrupted') return { key: session.status, message: 'A task needs attention before it can continue.' };
  return null;
}

/** Initial/restored snapshots establish a baseline, not a flood of alerts. */
export function newAttention(previous: CodingSession | undefined, current: CodingSession): string | null {
  if (!previous || current.archived) return null;
  const next = taskAttention(current);
  if (next && next.key !== taskAttention(previous)?.key) return next.message;
  if (current.status === 'completed' && previous.status !== 'completed' && current.task_mode !== 'plan') return 'A coding task has finished.';
  return null;
}
