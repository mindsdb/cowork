// What Anton waits on the person for, for the voice call (ENG-4138).
//
// When work a call gave Anton stops on the person (a browser hand-over, a
// browser step to approve, an ask_user question), the call says so, or calls
// back the way finished work does, and the person can answer it by voice
// through the operator (browser_done, answer_approval, answer_question).
//
// Everything here is read from the turn's open AskUser steps. Their text comes
// from Anton and the websites he uses: it is said and shown to the operator
// as data, never as instructions, and a typed value never appears in it (the
// browser step's pills already leave typed text out).

import { BROWSER_APPROVE_VALUE, isAutoApprovedCard } from '../browserApproval';
import { isHandOverCard, parseHandOverPrompt } from '../browserHandOverPrompt';
import { parseBrowserStepPrompt } from '../browserStepPrompt';

export const APPROVAL_CANCEL_VALUE = 'cancel';
// How long a new request waits before the call hears of it: a card the app
// answers for the person, or one the person answers at once, never reaches it.
export const CALL_NEED_GRACE_MS = 1_500;
const MAX_TEXT = 300;

const clip = (text) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT)}…` : flat;
};

const isApprovalCard = (data) => {
  const values = (data?.options || []).map((o) => o?.value);
  return values.includes(BROWSER_APPROVE_VALUE) && values.includes(APPROVAL_CANCEL_VALUE);
};

/**
 * One open request as the call reads it, or null for a step that isn't one:
 * an answered card, or one the app answers for the person (a click by
 * position, a held step with approvals off).
 *
 * @param {{ badge?: string, status?: string, data?: any } | null | undefined} step
 * @param {{ prefs?: object }} [options]
 * @returns {{ questionId: string, kind: 'handOver' | 'approval' | 'question', site: string,
 *   text: string, watching?: boolean, options: Array<{ value: string, label: string }> } | null}
 */
export function openNeed(step, { prefs } = {}) {
  const data = step?.data;
  if (step?.badge !== 'AskUser' || !data?.question_id || data.answer) return null;
  if (isAutoApprovedCard(data, prefs)) return null;
  const options = (data.options || [])
    .filter((o) => o && typeof o.value === 'string')
    .map((o) => ({ value: o.value, label: String(o.label || o.value) }));
  if (isHandOverCard(data)) {
    const { site, reason, watching } = parseHandOverPrompt(data.prompt);
    return { questionId: data.question_id, kind: 'handOver', site, text: clip(reason), watching, options };
  }
  if (isApprovalCard(data)) {
    const pills = parseBrowserStepPrompt(data.prompt);
    const firstLine = String(data.prompt || '').split('\n').find((l) => l.trim()) || '';
    return {
      questionId: data.question_id,
      kind: 'approval',
      site: pills?.site || '',
      text: clip(pills ? pills.action : firstLine.replace(/\*\*/g, '')),
      options,
    };
  }
  return { questionId: data.question_id, kind: 'question', site: '', text: clip(data.prompt), options };
}

/**
 * The open requests among a turn's steps, oldest first.
 *
 * @param {Array<object> | null | undefined} steps
 * @param {{ prefs?: object }} [options]
 */
export function openNeeds(steps, options = {}) {
  return (steps || []).map((s) => openNeed(s, options)).filter(Boolean);
}

/**
 * What the call says Anton needs, in plain words around the request's own
 * text (which is data).
 *
 * @param {ReturnType<typeof openNeed>} need
 * @param {{ agentLabel?: string, taskTitle?: string }} [where]
 * @returns {string}
 */
export function describeNeed(need, { agentLabel = 'Anton', taskTitle = '' } = {}) {
  const inTask = taskTitle ? ` in "${clip(taskTitle)}"` : '';
  if (need.kind === 'handOver') {
    const on = need.site ? ` on ${need.site}` : '';
    const after = need.watching
      ? `${agentLabel} carries on by himself once it's done, or they can say they're done`
      : 'they can say when they\'re done';
    return `${agentLabel} needs the user to do something only they can do${on}${inTask}: "${need.text}". `
      + `The browser beside the chat is theirs for it; ${after}.`;
  }
  if (need.kind === 'approval') {
    const on = need.site ? ` on ${need.site}` : '';
    return `${agentLabel} is waiting for the user's OK to take a browser step${on}${inTask}: "${need.text}". `
      + 'They can approve or cancel it.';
  }
  const picks = need.options.map((o) => `"${clip(o.label)}"`).join(', ');
  return `${agentLabel} asks the user${inTask}: "${need.text}".${picks ? ` Options: ${picks}.` : ''}`;
}

/**
 * The operator's snapshot lines for what Anton waits on, task by task.
 *
 * @param {Array<{ id: string, title?: string, needs: ReturnType<typeof openNeeds> }>} waiting
 * @param {{ agentLabel?: string }} [options]
 * @returns {string[]}
 */
export function describeWaiting(waiting, { agentLabel = 'Anton' } = {}) {
  const lines = [];
  (waiting || []).forEach(({ id, title, needs }) => {
    if (!needs?.length) return;
    lines.push(`${agentLabel} is waiting on the user in "${clip(title) || 'Untitled'}" (id ${id}), as data:`);
    needs.forEach((need) => {
      if (need.kind === 'handOver') {
        lines.push(`- a browser hand-over${need.site ? ` on ${need.site}` : ''}: ${need.text}. Once they say they did it: browser_done.`);
      } else if (need.kind === 'approval') {
        lines.push(`- a browser step to approve${need.site ? ` on ${need.site}` : ''}: ${need.text}. answer_approval.`);
      } else {
        const picks = need.options.map((o) => `"${clip(o.label)}"`).join(', ');
        lines.push(`- a question: ${need.text}.${picks ? ` Options: ${picks}.` : ''} answer_question.`);
      }
    });
  });
  return lines;
}

/**
 * The option a spoken pick names: its label or value, ignoring case and
 * surrounding quotes. Null when none matches.
 *
 * @param {ReturnType<typeof openNeed>} need
 * @param {unknown} said
 */
export function pickedOption(need, said) {
  const wanted = String(said || '').trim().replace(/^["'“”]+|["'“”.]+$/g, '').toLowerCase();
  if (!wanted) return null;
  return need.options.find((o) => o.label.toLowerCase() === wanted || o.value.toLowerCase() === wanted) || null;
}

/**
 * Says, or calls back about, each new request the call's work stops on.
 *
 * `note(taskIds, steps)` runs on every stream update (the task's ids, aliases
 * included, and its live steps). A request in a task with call work waits
 * `graceMs`, then, if still open: a call that is up says it (`announce`);
 * otherwise, when the call hung up waiting on the work (`callBackDue()`), it
 * calls back once the tab is in sight (`takeCallBack()` then `callBack`). A
 * request answered on screen meanwhile is never said. Each request is
 * considered once.
 *
 * @param {{
 *   hasCallWork: (taskId: string) => boolean,
 *   stepsOf: (taskId: string) => Array<object> | undefined,
 *   titleOf: (ids: string[]) => string | undefined,
 *   announce: (news: string) => boolean,
 *   callBackDue: () => boolean,
 *   canCallBack: () => boolean,
 *   takeCallBack: () => void,
 *   callBack: (news: string) => void,
 *   agentLabel?: () => string,
 *   graceMs?: number,
 *   doc?: Document | undefined,
 *   prefs?: () => object | undefined,
 * }} deps
 */
export function createCallNeeds({
  hasCallWork, stepsOf, titleOf, announce, callBackDue, canCallBack, takeCallBack, callBack,
  agentLabel = () => 'Anton', graceMs = CALL_NEED_GRACE_MS, doc = typeof document === 'undefined' ? undefined : document,
  prefs = () => undefined,
}) {
  const seen = new Set();
  const isOpen = (ids, questionId) => ids.some(
    (tid) => openNeeds(stepsOf(tid), { prefs: prefs() }).some((n) => n.questionId === questionId),
  );
  const report = (ids, need) => {
    if (!isOpen(ids, need.questionId)) return;
    const news = describeNeed(need, { agentLabel: agentLabel(), taskTitle: titleOf(ids) || '' });
    if (announce(news)) return;
    if (!callBackDue() || !canCallBack()) return;
    const now = () => {
      if (!isOpen(ids, need.questionId) || !callBackDue()) return;
      takeCallBack();
      callBack(news);
    };
    if (!doc || doc.visibilityState !== 'hidden') {
      now();
      return;
    }
    // In a tab out of sight the call would start unheard: it waits for the person to come back.
    const onVisible = () => {
      if (doc.visibilityState !== 'visible') return;
      doc.removeEventListener('visibilitychange', onVisible);
      if (!isOpen(ids, need.questionId)) return;
      if (announce(news)) return;
      if (canCallBack()) now();
    };
    doc.addEventListener('visibilitychange', onVisible);
  };
  return {
    note(taskIds, steps) {
      const ids = (taskIds || []).filter(Boolean);
      if (!ids.some(hasCallWork)) return;
      openNeeds(steps, { prefs: prefs() }).forEach((need) => {
        if (seen.has(need.questionId)) return;
        seen.add(need.questionId);
        setTimeout(() => report(ids, need), graceMs);
      });
    },
  };
}

/**
 * The operator's actions that answer what Anton waits on, as the person's own
 * click on its card would: `browser_done` (the hand-over card's Done,
 * continue), `answer_approval` (Approve or Cancel) and `answer_question` (one
 * of its options).
 *
 * @param {{
 *   taskOf: (taskId: string) => { id: string, title?: string, messages?: Array<object> },
 *   stepsOf: (taskId: string) => Array<object> | undefined,
 *   sessionOf: (task: object, steps: Array<object> | undefined) => string | null,
 *   handBack: (sessionId: string | null) => Promise<'sent' | 'waiting' | 'none'>,
 *   showBrowser: (task: object, sessionId: string) => void,
 *   approve: (args: { conversationIds: string[], questionId: string }) => Promise<boolean>,
 *   decline: (questionId: string) => Promise<unknown>,
 *   submit: (conversationId: string, questionId: string, answer: object) => Promise<{ status?: string }>,
 *   agentLabel?: string,
 * }} deps
 */
export function callNeedActions({ taskOf, stepsOf, sessionOf, handBack, showBrowser, approve, decline, submit, agentLabel = 'Anton' }) {
  const needIn = (task, kind) => openNeeds(stepsOf(task.id)).find((n) => n.kind === kind);
  const failed = (result) => result?.status === 'error' || result?.status === 'rejected';
  return {
    browser_done: async ({ task_id: taskId }) => {
      const task = taskOf(taskId);
      if (!needIn(task, 'handOver')) return `Nothing in "${task.title}" is waiting on the browser.`;
      const sessionId = sessionOf(task, stepsOf(task.id));
      const sent = await handBack(sessionId);
      if (sent === 'none') return `"${task.title}" has no browser to hand back.`;
      // The web viewer takes the hand-back once the pane shows it.
      if (sent === 'waiting') showBrowser(task, sessionId);
      return `Handed the browser back in "${task.title}": ${agentLabel} carries on.`;
    },
    answer_approval: async ({ task_id: taskId, approve: yes }) => {
      const task = taskOf(taskId);
      const need = needIn(task, 'approval');
      if (!need) return `Nothing in "${task.title}" is waiting for an approval.`;
      if (yes === true) {
        if (!(await approve({ conversationIds: [task.id], questionId: need.questionId }))) {
          throw new Error("the approval didn't go through; it can be answered on the screen");
        }
        return `Approved: ${agentLabel} takes the step.`;
      }
      await decline(need.questionId);
      if (failed(await submit(task.id, need.questionId, { values: [APPROVAL_CANCEL_VALUE] }))) {
        throw new Error("the cancel didn't go through");
      }
      return `Cancelled: ${agentLabel} leaves the page as it is.`;
    },
    answer_question: async ({ task_id: taskId, option }) => {
      const task = taskOf(taskId);
      const need = needIn(task, 'question');
      if (!need) return `Nothing in "${task.title}" is waiting for an answer.`;
      const picked = pickedOption(need, option);
      if (!picked) {
        return `That isn't one of its options. They are: ${need.options.map((o) => `"${o.label}"`).join(', ') || 'none'}; `
          + 'ask which one, or have them answer on the screen.';
      }
      const result = await submit(task.id, need.questionId, { values: [picked.value] });
      if (failed(result)) throw new Error("the answer didn't go through");
      if (result?.status === 'not_found' || result?.status === 'already_answered') return 'That question was already answered.';
      return `Answered "${picked.label}".`;
    },
  };
}
