import type { CodingEvent, CodingSession } from './api';
import { isActiveStatus } from './presentation';


export interface FailureRecovery {
  title: (modelName: string) => string;
  body: string;
  addCredits?: boolean;
  // A limit on the whole organization does not lift on another model.
  hideModelChoice?: boolean;
  // The turn stopped, but only until a short limit lifts. It reads as a wait,
  // not as a failure of the product.
  temporary?: boolean;
}

export const FAILURE_RECOVERY: Partial<Record<string, FailureRecovery>> = {
  insufficient_credits: {
    title: (modelName) => `${modelName} needs credits`,
    body: 'Add credits or choose another model, then continue in this task.',
    addCredits: true,
  },
  model_authentication_failed: {
    title: () => 'Your sign-in does not match this server',
    body: 'Sign in again, or switch back to the environment you signed into, then continue in this task.',
  },
  model_unavailable: {
    title: (modelName) => `${modelName} is not available`,
    body: 'Choose another model, then continue in this task.',
  },
  rate_limited: {
    title: () => 'MindsHub is receiving requests too quickly',
    body: 'This turn stopped. Wait a moment, then continue in this task.',
    hideModelChoice: true,
    temporary: true,
  },
  included_allowance_exhausted: {
    title: () => 'Your included allowance is used up',
    body: 'Add credits to continue now, or wait for the allowance to refill, then continue in this task.',
    addCredits: true,
  },
  free_air_daily_spend_fuse_exceeded: {
    title: () => 'Free MindsHub Air is paused',
    body: 'It resumes when the daily budget resets. Add credits or choose another model to continue now.',
    addCredits: true,
  },
};


const RECOVERABLE_RUNS = ['interrupted', 'failed', 'recovering'];
const ACTIVE_RUNS = ['queued', 'preparing', 'ready', 'running', 'awaiting_approval'];


/** Whether the last turn ended on a failure that has not been superseded by new work. */
export function turnEndedOnFailure(session: CodingSession): boolean {
  const recoverable = RECOVERABLE_RUNS.includes(session.run_status || '');
  if (session.task_mode === 'plan' && session.status === 'completed') return false;
  if (ACTIVE_RUNS.includes(session.run_status || '')) return false;
  if (isActiveStatus(session.status) || (session.status === 'ready' && !recoverable)) return false;
  return recoverable || session.status === 'failed' || session.status === 'interrupted';
}


export interface TurnFailure {
  code: string;
  recovery: FailureRecovery;
  detail: string;
}


/**
 * An account or model limit that stopped the last turn. It is about the next
 * send rather than the transcript, so it belongs beside the composer.
 */
export function accountFailure(
  session: CodingSession,
  latestSession: CodingEvent | undefined,
  latestError: CodingEvent | undefined,
  recovering = false,
): TurnFailure | null {
  if (recovering || session.run_status === 'recovering' || !turnEndedOnFailure(session)) return null;
  const failure = failureEvent(latestSession, latestError);
  const code = failure?.data.code;
  const recovery = typeof code === 'string' ? FAILURE_RECOVERY[code] : undefined;
  if (typeof code !== 'string' || !recovery) return null;
  return { code, recovery, detail: failureDetail(session, failure) };
}


function failureEvent(latestSession: CodingEvent | undefined, latestError: CodingEvent | undefined): CodingEvent | undefined {
  return latestSession?.data.status === 'failed' && typeof latestSession.data.code === 'string' ? latestSession : latestError;
}


function failureDetail(session: CodingSession, failure: CodingEvent | undefined): string {
  const technical = typeof failure?.data.detail === 'string' ? failure.data.detail : '';
  return technical || session.last_error || failure?.text || '';
}


export type NoticeTone = 'neutral' | 'warning' | 'danger';

export interface ComposerNotice {
  key: string;
  tone: NoticeTone;
  icon: 'clock' | 'warning' | 'refresh';
  title: string;
  body?: string;
  detail?: string;
  chooseModel?: boolean;
  addCredits?: boolean;
  /** The remote run stopped but kept its work; Reopen task restores it. */
  reopen?: boolean;
  reopening?: boolean;
  /** Queued follow-ups take the lip's place instead of a line of text. */
  queue?: boolean;
  dismissible?: boolean;
}


/** Only one notice shows at a time; the first present candidate wins. */
export function pickNotice(candidates: Array<ComposerNotice | null | undefined>, dismissed: ReadonlySet<string>): ComposerNotice | null {
  return candidates.find((notice): notice is ComposerNotice => !!notice && !dismissed.has(notice.key)) || null;
}


// A model id such as "gpt" can lead a title; titles still read as sentences.
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}


export function failureNotice(failure: TurnFailure | null, modelName: string): ComposerNotice | null {
  if (!failure) return null;
  const { recovery } = failure;
  return {
    key: `failure:${failure.code}`,
    tone: recovery.temporary ? 'warning' : 'danger',
    icon: recovery.temporary ? 'clock' : 'warning',
    title: sentenceCase(recovery.title(modelName || 'This model')),
    body: recovery.body,
    detail: failure.detail,
    chooseModel: !recovery.hideModelChoice,
    addCredits: recovery.addCredits,
  };
}


/**
 * A remote run that stopped with its work preserved, such as when the task
 * computer went offline. Account and model limits speak for themselves.
 */
export function recoveryNotice(
  session: CodingSession,
  latestSession: CodingEvent | undefined,
  latestError: CodingEvent | undefined,
  recovering = false,
): ComposerNotice | null {
  if (!RECOVERABLE_RUNS.includes(session.run_status || '') || isActiveStatus(session.status)) return null;
  if (accountFailure(session, latestSession, latestError, recovering)) return null;
  if (recovering || session.run_status === 'recovering') {
    return { key: 'recovery:reopening', tone: 'neutral', icon: 'refresh', title: 'Reopening task', body: 'Reconnecting to the task files…', reopen: true, reopening: true };
  }
  return {
    key: 'recovery:paused',
    tone: 'warning',
    icon: 'refresh',
    title: 'Task paused',
    body: session.computer_status === 'offline'
      ? 'The task computer disconnected. Your conversation is safe; reopen it there or choose another compatible computer.'
      : 'The turn stopped before it completed. Reopening restores the working copy; send a message to continue the interrupted work.',
    detail: failureDetail(session, failureEvent(latestSession, latestError)),
    reopen: true,
  };
}


export function queueNotice(session: CodingSession): ComposerNotice | null {
  return session.queued_instructions?.length ? { key: 'queue', tone: 'neutral', icon: 'clock', title: '', queue: true } : null;
}


export function messageNotice(kind: 'error' | 'workspace', message: string): ComposerNotice | null {
  if (!message) return null;
  return kind === 'error'
    ? { key: `error:${message}`, tone: 'danger', icon: 'warning', title: '', body: message, dismissible: true }
    : { key: `workspace:${message}`, tone: 'warning', icon: 'warning', title: '', body: message, dismissible: true };
}
