import type { CodingEvent, CodingSession } from './api';
import { isActiveStatus } from './presentation';
import i18n from '../../lib/i18n';
import { budgetPeriodOf, budgetScopeOf, type BudgetPeriod, type BudgetScope } from '../lib/budgetScope';


export interface FailureRecovery {
  // `budgetScope` is only read by budget_exceeded, which names whose budget is spent and who can raise it.
  title: (modelName: string, budgetScope: BudgetScope, budgetPeriod: BudgetPeriod) => string;
  body: (budgetScope: BudgetScope, budgetModelLabel: string | null) => string;
  addCredits?: boolean;
  // A spent budget: credits do not lift it, so the action opens Budgets instead.
  viewBudgets?: boolean;
  // A limit on the whole organization does not lift on another model.
  hideModelChoice?: boolean;
  // The turn stopped, but only until a short limit lifts. It reads as a wait,
  // not as a failure of the product.
  temporary?: boolean;
  // The billing_opened trigger for "Add credits", in the vocabulary chat mode
  // already reports, so a Code Mode click lands in the same series.
  billingTrigger?: BillingTrigger;
}

export type BillingTrigger =
  | 'token_limit'
  | 'included_allowance_exhausted'
  | 'free_serving_paused'
  | 'window_allowance_exhausted'
  | 'model_not_in_tier';

export const FAILURE_RECOVERY: Partial<Record<string, FailureRecovery>> = {
  insufficient_credits: {
    title: (modelName) => i18n.t('composerNotices.insufficientCredits.title', { ns: 'code', model: modelName }),
    body: () => i18n.t('composerNotices.insufficientCredits.body', { ns: 'code' }),
    addCredits: true,
    billingTrigger: 'token_limit',
  },
  model_authentication_failed: {
    title: () => i18n.t('composerNotices.authFailed.title', { ns: 'code' }),
    body: () => i18n.t('composerNotices.authFailed.body', { ns: 'code' }),
  },
  model_unavailable: {
    title: (modelName) => i18n.t('composerNotices.modelUnavailable.title', { ns: 'code', model: modelName }),
    body: () => i18n.t('composerNotices.modelUnavailable.body', { ns: 'code' }),
  },
  rate_limited: {
    title: () => i18n.t('composerNotices.rateLimited.title', { ns: 'code' }),
    body: () => i18n.t('composerNotices.rateLimited.body', { ns: 'code' }),
    hideModelChoice: true,
    temporary: true,
  },
  included_allowance_exhausted: {
    title: () => i18n.t('composerNotices.allowanceExhausted.title', { ns: 'code' }),
    body: () => i18n.t('composerNotices.allowanceExhausted.body', { ns: 'code' }),
    addCredits: true,
    billingTrigger: 'included_allowance_exhausted',
  },
  free_air_daily_spend_fuse_exceeded: {
    title: () => i18n.t('composerNotices.freeAirPaused.title', { ns: 'code' }),
    body: () => i18n.t('composerNotices.freeAirPaused.body', { ns: 'code' }),
    addCredits: true,
    billingTrigger: 'free_serving_paused',
  },
  // A Plus or Pro window is used up and the wallet is empty: the window is
  // the plan's included allowance, so it reads like the free one running out.
  window_allowance_exhausted: {
    title: () => i18n.t('composerNotices.allowanceExhausted.title', { ns: 'code' }),
    body: () => i18n.t('composerNotices.allowanceExhausted.body', { ns: 'code' }),
    addCredits: true,
    billingTrigger: 'window_allowance_exhausted',
  },
  // The plan does not cover this model and the wallet is empty: credits pay
  // for it at API rates, or a model the plan covers runs now.
  model_not_in_tier: {
    title: (modelName) => i18n.t('composerNotices.insufficientCredits.title', { ns: 'code', model: modelName }),
    body: () => i18n.t('composerNotices.insufficientCredits.body', { ns: 'code' }),
    addCredits: true,
    billingTrigger: 'model_not_in_tier',
  },
  // Credits do not lift it, but MindsHub Air may still run free.
  budget_exceeded: {
    title: (_modelName, budgetScope, budgetPeriod) =>
      i18n.t('composerNotices.budgetExceeded.title', { ns: 'code', scope: budgetScope, period: budgetPeriod }),
    body: (budgetScope, budgetModelLabel) => i18n.t('composerNotices.budgetExceeded.body', {
      ns: 'code', scope: budgetScope, hasModel: budgetModelLabel ? 'true' : 'other', model: budgetModelLabel || '',
    }),
    viewBudgets: true,
  },
};


const RECOVERABLE_RUNS = ['interrupted', 'failed', 'recovering'];
const ACTIVE_RUNS = ['queued', 'preparing', 'ready', 'running', 'awaiting_approval'];


/** A task on this computer whose workspace could not be prepared. */
export function taskNeverStarted(session: CodingSession): boolean {
  return session.run_status === 'failed' && session.computer_is_local !== false && !session.workspace_path;
}


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
  budgetScope: BudgetScope;
  budgetPeriod: BudgetPeriod;
  // A per-model budget's alias; null for a budget on every model.
  budgetModel: string | null;
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
  return {
    code,
    recovery,
    detail: failureDetail(session, failure),
    budgetScope: budgetScopeOf(failure?.data.budget_scope),
    budgetPeriod: budgetPeriodOf(failure?.data.budget_period),
    budgetModel: typeof failure?.data.budget_model === 'string' && failure.data.budget_model ? failure.data.budget_model : null,
  };
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
  viewBudgets?: boolean;
  billingTrigger?: BillingTrigger;
  /** The remote run stopped but kept its work; Reopen task restores it. */
  reopen?: boolean;
  reopening?: boolean;
  /** The task reads only until the user lets it change the folder. */
  allowWrites?: boolean;
  /** Task controls cannot change while a turn runs. */
  actionDisabled?: boolean;
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


export function failureNotice(
  failure: TurnFailure | null,
  modelName: string,
  // Catalog label for a model alias; the alias itself when the catalog has none.
  labelFor: (id: string) => string = (id) => id,
): ComposerNotice | null {
  if (!failure) return null;
  const { recovery } = failure;
  return {
    key: `failure:${failure.code}`,
    tone: recovery.temporary ? 'warning' : 'danger',
    icon: recovery.temporary ? 'clock' : 'warning',
    title: sentenceCase(recovery.title(modelName || i18n.t('composerNotices.thisModel', { ns: 'code' }), failure.budgetScope, failure.budgetPeriod)),
    body: recovery.body(failure.budgetScope, failure.budgetModel ? labelFor(failure.budgetModel) : null),
    detail: failure.detail,
    chooseModel: !recovery.hideModelChoice,
    addCredits: recovery.addCredits,
    viewBudgets: recovery.viewBudgets,
    billingTrigger: recovery.billingTrigger,
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
  if (taskNeverStarted(session)) {
    // There is no working copy to reopen; the agent never ran.
    return {
      key: 'recovery:not-started',
      tone: 'danger',
      icon: 'warning',
      title: i18n.t('composerNotices.notStarted.title', { ns: 'code' }),
      body: i18n.t('composerNotices.notStarted.body', { ns: 'code' }),
      detail: failureDetail(session, failureEvent(latestSession, latestError)),
    };
  }
  if (accountFailure(session, latestSession, latestError, recovering)) return null;
  if (recovering || session.run_status === 'recovering') {
    return { key: 'recovery:reopening', tone: 'neutral', icon: 'refresh', title: i18n.t('composerNotices.reopening.title', { ns: 'code' }), body: i18n.t('composerNotices.reopening.body', { ns: 'code' }), reopen: true, reopening: true };
  }
  return {
    key: 'recovery:paused',
    tone: 'warning',
    icon: 'refresh',
    title: i18n.t('composerNotices.paused.title', { ns: 'code' }),
    body: session.computer_status === 'offline'
      ? i18n.t('composerNotices.paused.offlineBody', { ns: 'code' })
      : i18n.t('composerNotices.paused.interruptedBody', { ns: 'code' }),
    detail: failureDetail(session, failureEvent(latestSession, latestError)),
    reopen: true,
  };
}


export function queueNotice(session: CodingSession): ComposerNotice | null {
  return session.queued_instructions?.length ? { key: 'queue', tone: 'neutral', icon: 'clock', title: '', queue: true } : null;
}


/**
 * A task on a folder with no commit to review or undo against starts with a
 * read-only sandbox. Full access never had one, and older servers omit the flag.
 */
export function writesNotice(session: CodingSession): ComposerNotice | null {
  if (session.writes_allowed !== false || session.permission_mode === 'full_access') return null;
  return {
    key: 'writes-held',
    tone: 'warning',
    icon: 'warning',
    title: '',
    body: i18n.t('composerNotices.writesHeld.body', { ns: 'code' }),
    allowWrites: true,
    actionDisabled: isActiveStatus(session.status),
    dismissible: true,
  };
}


export function messageNotice(kind: 'error' | 'workspace', message: string): ComposerNotice | null {
  if (!message) return null;
  return kind === 'error'
    ? { key: `error:${message}`, tone: 'danger', icon: 'warning', title: '', body: message, dismissible: true }
    : { key: `workspace:${message}`, tone: 'warning', icon: 'warning', title: '', body: message, dismissible: true };
}

type ReleaseState = Pick<CodingSession, 'archived' | 'workspace_released_at' | 'workspace_kept_reason' | 'workspace_restore_error'>;

/**
 * What the task view says about a workspace put away to save disk: a failed
 * rebuild first, since it needs the user, then that it is put away, then why
 * an archived task kept its workspace. Older servers send none of these.
 */
export function releaseNotice(session: ReleaseState): ComposerNotice | null {
  if (session.workspace_restore_error) {
    return {
      key: `release-error:${session.workspace_restore_error}`,
      tone: 'danger',
      icon: 'warning',
      title: i18n.t('composerNotices.restoreError.title', { ns: 'code' }),
      body: i18n.t('composerNotices.restoreError.body', { ns: 'code', error: session.workspace_restore_error }),
      dismissible: false,
    };
  }
  if (session.workspace_released_at) {
    return {
      key: `released:${session.workspace_released_at}`,
      tone: 'warning',
      icon: 'warning',
      title: '',
      body: i18n.t('composerNotices.released.body', { ns: 'code' }),
      dismissible: true,
    };
  }
  if (session.archived && session.workspace_kept_reason) {
    return {
      key: `kept:${session.workspace_kept_reason}`,
      tone: 'warning',
      icon: 'warning',
      title: '',
      body: i18n.t('composerNotices.kept.body', { ns: 'code', reason: session.workspace_kept_reason }),
      dismissible: true,
    };
  }
  return null;
}
