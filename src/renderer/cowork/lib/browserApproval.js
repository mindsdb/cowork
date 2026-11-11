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
import { approveBrowserStep, declineBrowserStep } from '../api';

export const BROWSER_APPROVE_VALUE = 'approve';

const APPROVAL_PREFIX = 'browser:approve:';
const APPROVAL_QUESTION = new RegExp(`^${APPROVAL_PREFIX}([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{1,64})$`);

/** What the card says on Approve when its ids can't be read. */
export const UNREADABLE_APPROVAL = "This approval request can't be checked, so nothing ran.";

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
    return 'This step is no longer waiting in the browser, so nothing ran.';
  }
  if (err?.code === 'unavailable' || err?.status === 409) return "The browser isn't available here, so nothing ran.";
  /* Only a server's refusal carries a status (responseError in api.js); a
     network or parse error's own text is the engine's, not a reason. */
  const fromServer = typeof err?.status === 'number' && typeof err?.message === 'string';
  const reason = fromServer && err.message && !/^API \//.test(err.message) ? err.message.replace(/\.$/, '') : '';
  return reason ? `Couldn't approve this step in the browser: ${reason}.` : "Couldn't approve this step in the browser. Try again.";
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
  return { ok: false, message: "The browser didn't confirm the approval, so nothing ran. Try again." };
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
   clicks at a point its element list doesn't name. That card is only noise
   for the person (the point is on the page the agent is already working on),
   so the app approves it itself and never shows it. A step that commits
   something (a purchase, a message, a deletion) keeps its card. */
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
