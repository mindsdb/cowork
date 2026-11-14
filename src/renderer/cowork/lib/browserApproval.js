/* The commit hold: the web browser holds a consequential step (submit, buy,
   send, delete and the like) until the person approves it on the chat card.

   The card's question id carries both ids, `browser:approve:<session_id>:
   <pending_id>`, and its Approve option has the value `approve`. On the web,
   Approve first records the approval in the browser through POST
   /browse/approve, and answers the card only after the browser confirms it;
   on any refusal the card stays open and says why. A card with that prefix
   whose ids can't be read is refused on Approve. Any other answer first
   declines the held step through POST /browse/decline, best effort, and the
   card is answered whatever the decline answers. A card with any other id,
   and every card on the desktop (whose browser holds nothing), is answered
   directly. */

import { diagnostic } from '../../../shared/diagnostics';
import { approveBrowserStep, declineBrowserStep, readBrowserApproveSteps } from '../api';
import { getBrowserPrefs, heldAfterApprovalsOff } from './browserPrefs';
import i18n from '../../lib/i18n';

const tr = (key, vars) => i18n.t(`messages.browserApproval.${key}`, { ns: 'projects', ...vars });

export const BROWSER_APPROVE_VALUE = 'approve';

const APPROVAL_PREFIX = 'browser:approve:';
const APPROVAL_QUESTION = new RegExp(`^${APPROVAL_PREFIX}([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{1,64})$`);

/** What the card says on Approve when its ids can't be read. */
export const UNREADABLE_APPROVAL = "This approval request can't be checked, so nothing ran.";
export const unreadableApproval = () => tr('unreadable');

/**
 * Whether a card is a commit-hold card: its id has the commit hold's prefix,
 * whether or not browserApprovalIds can read the ids after it.
 *
 * @param {unknown} questionId
 * @returns {boolean}
 */
export function isBrowserApprovalCard(questionId) {
  return typeof questionId === 'string' && questionId.startsWith(APPROVAL_PREFIX);
}

/**
 * The session and held step a commit-hold card names, or null for any other
 * card.
 *
 * @param {unknown} questionId
 * @returns {{ sessionId: string, pendingId: string } | null}
 */
export function browserApprovalIds(questionId) {
  const match = typeof questionId === 'string' ? APPROVAL_QUESTION.exec(questionId) : null;
  return match ? { sessionId: match[1], pendingId: match[2] } : null;
}

/* What the card says when the browser refuses the approval. */
export function approvalRefusalText(err) {
  // With no running browser (`session_not_found`), no step is held either.
  if (err?.code === 'approval_lapsed' || err?.code === 'session_not_found') {
    return tr('lapsed');
  }
  if (err?.code === 'unavailable' || err?.status === 409) return tr('unavailable');
  /* Only a server's refusal carries a status (responseError in api.js); a
     network or parse error's own text is the engine's, not a reason. */
  const fromServer = typeof err?.status === 'number' && typeof err?.message === 'string';
  const reason = fromServer && err.message && !/^API \//.test(err.message) ? err.message.replace(/\.$/, '') : '';
  return reason ? tr('refusedReason', { reason }) : tr('refused');
}

/**
 * Records the person's approval of one held step in the browser.
 *
 * @param {{ sessionId: string, pendingId: string }} ids
 * @param {typeof approveBrowserStep} [approve]
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
export async function recordBrowserApproval(ids, approve = approveBrowserStep) {
  let answer;
  try {
    answer = await approve(ids.sessionId, ids.pendingId);
  } catch (err) {
    return { ok: false, message: approvalRefusalText(err) };
  }
  if (answer?.approved === true && answer.pending_id === ids.pendingId) return { ok: true };
  return { ok: false, message: tr('notConfirmed') };
}

/**
 * Declines one held step in the browser, so neither it nor an approval
 * already recorded for it can run. Best effort: the card is answered whatever
 * this answers, so it never throws. A failure is logged, except a 404 from a
 * server that has no decline route yet.
 *
 * @param {{ sessionId: string, pendingId: string }} ids
 * @param {typeof declineBrowserStep} [decline]
 * @returns {Promise<void>}
 */
export async function declineBrowserApproval(ids, decline = declineBrowserStep) {
  try {
    await decline(ids.sessionId, ids.pendingId);
  } catch (err) {
    if (err?.status !== 404) diagnostic('renderer.cowork.lib.browserApproval', 'WARNING', 'browser_decline_failed', err);
  }
}

/* Clicks by position: the agent's browser asks once per page before it
   clicks at a point its element list doesn't name. Clicks by position run
   without the person's approval, whatever the setting: the app approves that
   card itself and never shows it. A step that commits something (a purchase,
   a message, a deletion) keeps its card while the person approves browser
   steps (Settings > Shared browser, on by default); with that off, the app
   approves it too (isAutoApprovedCard). */
export const POSITION_APPROVE_DETAIL = 'Allow clicks by position on this page';

/* How long a position card waits on the automatic approval before it shows,
   so a failed one still reaches the person. */
export const POSITION_AUTO_APPROVE_MS = 4000;

/**
 * Whether a question asks to approve clicks by position.
 *
 * @param {{ options?: Array<{ value?: string, detail?: string }> } | null | undefined} data
 * @returns {boolean}
 */
export function isPositionClickCard(data) {
  return (data?.options || []).some(
    (o) => o?.value === BROWSER_APPROVE_VALUE && o?.detail === POSITION_APPROVE_DETAIL,
  );
}

/* The Approve option's line on a step card (anton's browser tool), which
   marks the desktop's cards: they carry no commit-hold id. */
export const STEP_APPROVE_DETAIL = 'Take this step once';

/**
 * Whether a question asks to approve a browser step: a commit-hold card (its
 * id has the hold's prefix) with an Approve option, or a card whose Approve
 * is a step's "Take this step once".
 *
 * @param {{ question_id?: string, options?: Array<{ value?: string, detail?: string }> } | null | undefined} data
 * @returns {boolean}
 */
export function isBrowserStepCard(data) {
  const approves = (data?.options || []).filter((o) => o?.value === BROWSER_APPROVE_VALUE);
  if (!approves.length) return false;
  return isBrowserApprovalCard(data?.question_id) || approves.some((o) => o?.detail === STEP_APPROVE_DETAIL);
}

/**
 * Whether the app approves this card for the person and keeps it out of
 * sight: a click by position always; a held browser step only once the
 * person turned Approve browser steps off (Settings > Shared browser), and
 * only one held after that (lib/browserPrefs.js). While they approve steps,
 * the default, a held step's card shows, and so does every card that was
 * waiting when they turned approvals off, the card they did it from included.
 *
 * @param {Parameters<typeof isBrowserStepCard>[0] & { held_at_ms?: unknown }} data
 * @param {{ askToApprove?: boolean, approvalsOffAtMs?: number | null }} [prefs]
 * @returns {boolean}
 */
export function isAutoApprovedCard(data, prefs = getBrowserPrefs()) {
  if (isPositionClickCard(data)) return true;
  return prefs.askToApprove === false && isBrowserStepCard(data) && heldAfterApprovalsOff(data?.held_at_ms, prefs.approvalsOffAtMs);
}

/**
 * Whether a step is the person's turn in the browser: an unanswered card the
 * browser asks them (a held step to approve, a sign-in, a CAPTCHA or another
 * hand-over, all `browser:` cards). A card the app approves for them is not.
 *
 * @param {{ badge?: string, data?: object } | null | undefined} step
 * @returns {boolean}
 */
export function isPersonsBrowserTurn(step) {
  if (step?.badge !== 'AskUser' || step.data?.answer) return false;
  const data = step.data;
  if (isAutoApprovedCard(data)) return false;
  return isBrowserStepCard(data) || String(data?.question_id || '').startsWith('browser:');
}

/**
 * Approves a position card for the person: on the web the browser records
 * the approval first, then the card is answered under the first of
 * `conversationIds` the server knows.
 *
 * @param {{ conversationIds: string[], questionId: string, isWeb: boolean,
 *   approve?: typeof approveBrowserStep,
 *   submit: (conversationId: string, questionId: string, answer: object) => Promise<{ status?: string }> }} args
 * @returns {Promise<boolean>} whether the card was answered
 */
export async function autoApprovePositionClick({ conversationIds, questionId, isWeb, approve = approveBrowserStep, submit }) {
  if (isWeb && isBrowserApprovalCard(questionId)) {
    const held = browserApprovalIds(questionId);
    if (!held) return false;
    const recorded = await recordBrowserApproval(held, approve);
    if (!recorded.ok) return false;
  }
  for (const conversationId of conversationIds.filter(Boolean)) {
    const result = await submit(conversationId, questionId, { values: [BROWSER_APPROVE_VALUE] });
    if (result?.status === 'not_found') continue;
    return result?.status !== 'error' && result?.status !== 'rejected';
  }
  return false;
}

/**
 * Approves a card for the person (autoApprovePositionClick) only once the
 * server confirms they turned Approve browser steps off before the card was
 * held (`heldAtMs`, the card's `held_at_ms`): a choice made on another device
 * since this tab read settings counts at once. A card that was waiting when
 * approvals went off, on any device, is `kept` for the person, and a setting
 * that can't be read leaves the card to them too.
 *
 * @param {Parameters<typeof autoApprovePositionClick>[0] & {
 *   heldAtMs?: unknown, readAsks?: typeof readBrowserApproveSteps }} args
 * @returns {Promise<'approved' | 'failed' | 'asks' | 'kept' | 'unread'>}
 */
export async function approveIfApprovalsOff({ heldAtMs, readAsks = readBrowserApproveSteps, ...args }) {
  const setting = await readAsks();
  if (setting === null) return 'unread';
  if (setting.asks) return 'asks';
  if (!heldAfterApprovalsOff(heldAtMs, setting.offAtMs)) return 'kept';
  return (await autoApprovePositionClick(args)) ? 'approved' : 'failed';
}

/**
 * Approves for the person, once each, the unanswered cards among a stream's
 * steps that the app approves (isAutoApprovedCard): a click by position at
 * once (autoApprovePositionClick), a held browser step only once the server
 * confirms approvals went off before the card was held (approveIfApprovalsOff,
 * with the card's `held_at_ms`). Every card it starts on goes into `seen`
 * before anything is awaited, so a stream event that repeats the card never
 * approves it twice. A card the approval doesn't land on shows after
 * POSITION_AUTO_APPROVE_MS (components/AskUserCard.jsx), so the person can
 * still answer it; a failure here is not reported.
 *
 * @param {{ taskIds: Array<string | null | undefined>,
 *   steps: Array<{ badge?: string, data?: object }> | null | undefined,
 *   seen: Set<string>, isWeb: boolean,
 *   submit: Parameters<typeof autoApprovePositionClick>[0]['submit'],
 *   readAsks?: typeof readBrowserApproveSteps }} args
 * @returns {Promise<void>} settles once every approval it started has
 */
export async function approveCardsForPerson({ taskIds, steps, seen, isWeb, submit, readAsks }) {
  const approvals = [];
  for (const step of steps || []) {
    const questionId = step.badge === 'AskUser' && !step.data?.answer ? step.data?.question_id : null;
    if (!questionId || seen.has(questionId) || !isAutoApprovedCard(step.data)) continue;
    seen.add(questionId);
    const approval = { conversationIds: taskIds, questionId, isWeb, submit };
    approvals.push(isPositionClickCard(step.data)
      ? autoApprovePositionClick(approval)
      : approveIfApprovalsOff({ ...approval, heldAtMs: step.data.held_at_ms, readAsks }));
  }
  await Promise.allSettled(approvals);
}
