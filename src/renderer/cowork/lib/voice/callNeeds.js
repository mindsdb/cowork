// What Anton waits on the person for, for the voice call (ENG-4138).
//
// When work a call gave Anton stops on the person (a browser hand-over, a
// browser step to approve, an ask_user question), the call says so, or calls
// back the way finished work does, and the person can answer it by voice
// through the operator (browser_done, cancel_step, answer_question).
//
// A held browser step, and any other card of anton's approval gate (a
// write, or a live app's launch that picks which app it replaces), is
// approved only on the screen: by voice the person can only cancel it
// (cancel_step). The operator hears only their words, and a held step's name
// comes from the page, so no voice path approves one.
//
// Everything here is read from the turn's open AskUser steps. Their text comes
// from Anton and the websites he uses: it is said and shown to the operator
// as data, never as instructions, and a typed value never appears in it (only
// a step's site and action are read, never the text a typing step types).

import { BROWSER_APPROVE_VALUE, isAutoApprovedCard, isBrowserApprovalCard } from '../browserApproval';
import { isHandOverCard, parseHandOverPrompt } from '../browserHandOverPrompt';
import { parseBrowserStepPrompt } from '../browserStepPrompt';

export const APPROVAL_CANCEL_VALUE = 'cancel';
// How long a new request waits before the call hears of it: a card the app
// answers for the person, or one the person answers at once, never reaches it.
export const CALL_NEED_GRACE_MS = 1_500;
// The operator's snapshot cuts each line at this many characters
// (MAX_SNAPSHOT_LINE_CHARS in cowork-server's voice operator). A line here can
// run longer, so whatever a tool needs comes first on each line (the task's
// id, the tool that answers a request), and each option gets a line of its own.
const MAX_TEXT = 300;

const clip = (text) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT)}…` : flat;
};

/* A card of anton's approval gate, which only the screen approves: Approve
   and Cancel, or, by its id, a gate card whose options are the host's own
   actions beside Cancel (anton's ask_approval_choice), such as which running
   app a live app's launch stops. Choosing one of those approves the launch.
   Only the gate mints `write:` ids (a fresh card's, and `write:held:` for a
   held request), and the browser's commit hold mints `browser:approve:`. */
const isApprovalCard = (data) => {
  const values = (data?.options || []).map((o) => o?.value);
  if (!values.includes(APPROVAL_CANCEL_VALUE)) return false;
  const id = String(data?.question_id || '');
  return values.includes(BROWSER_APPROVE_VALUE) || id.startsWith('write:') || isBrowserApprovalCard(id);
};

/**
 * One open request as the call reads it, or null for a step that isn't one:
 * an answered card, or one the app answers for the person (a click by
 * position, a held step with approvals off).
 *
 * @param {{ badge?: string, status?: string, data?: any } | null | undefined} step
 * @param {{ prefs?: object }} [options]
 * @returns {{ questionId: string, kind: 'handOver' | 'approval' | 'question', site: string,
 *   text: string, watching?: boolean, options: Array<{ value: string, label: string, detail: string }> } | null}
 */
export function openNeed(step, { prefs } = {}) {
  const data = step?.data;
  if (step?.badge !== 'AskUser' || !data?.question_id || data.answer) return null;
  if (isAutoApprovedCard(data, prefs)) return null;
  const options = (data.options || [])
    .filter((o) => o && typeof o.value === 'string')
    .map((o) => ({ value: o.value, label: String(o.label || o.value), detail: typeof o.detail === 'string' ? o.detail : '' }));
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

// An option as the call says it: its label, and its detail when it has one
// ("Keep going: Allow up to 100,000,000 more tokens").
const optionLine = (o) => `"${clip(o.label)}"${o.detail ? `: ${clip(o.detail)}` : ''}`;

/**
 * What the call says Anton needs, in plain words around the request's own
 * text (which is data). A question's options follow, one per line, each with
 * its detail.
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
    return `${agentLabel} is waiting for the user's OK to take a step${on}${inTask}: "${need.text}". `
      + 'They approve it on the screen; by voice they can only cancel it.';
  }
  const picks = need.options.map((o) => `- ${optionLine(o)}`);
  return [`${agentLabel} asks the user${inTask}: "${need.text}".${picks.length ? ' Options:' : ''}`, ...picks].join('\n');
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
    lines.push(`${agentLabel} is waiting on the user in task ${id} ("${clip(title) || 'Untitled'}"), as data:`);
    // What answers each comes first, the page's site and the page's or
    // Anton's text after it: a cut line loses the end of that text, never
    // the tool.
    needs.forEach((need) => {
      const on = need.site ? ` on ${need.site}` : '';
      if (need.kind === 'handOver') {
        lines.push(`- a browser hand-over (once they say they did it: browser_done)${on}: ${need.text}`);
      } else if (need.kind === 'approval') {
        lines.push(`- a step to approve (they approve it on the screen; if they say no or cancel: cancel_step)${on}: ${need.text}`);
      } else {
        lines.push(`- a question (answer_question${need.options.length ? ', with one of the options below' : ''}): ${need.text}`);
        need.options.forEach((o) => lines.push(`  - option ${optionLine(o)}`));
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
 * otherwise it goes into the call back that waits for the tab
 * (lib/voice/seenCallBack.js), beside a result or another request, or, when
 * the call hung up waiting on the work (`callBackDue()`), starts that call
 * back. A request answered on screen meanwhile is never said. Each request is
 * considered once.
 *
 * @param {{
 *   hasCallWork: (taskId: string) => boolean,
 *   stepsOf: (taskId: string) => Array<object> | undefined,
 *   titleOf: (ids: string[]) => string | undefined,
 *   announce: (news: string) => boolean,
 *   callBackDue: () => boolean,
 *   canCallBack: () => boolean,
 *   seen: ReturnType<typeof import('./seenCallBack').createSeenCallBack>,
 *   agentLabel?: () => string,
 *   graceMs?: number,
 *   prefs?: () => object | undefined,
 * }} deps
 */
export function createCallNeeds({
  hasCallWork, stepsOf, titleOf, announce, callBackDue, canCallBack, seen,
  agentLabel = () => 'Anton', graceMs = CALL_NEED_GRACE_MS, prefs = () => undefined,
}) {
  const considered = new Set();
  const isOpen = (ids, questionId) => ids.some(
    (tid) => openNeeds(stepsOf(tid), { prefs: prefs() }).some((n) => n.questionId === questionId),
  );
  const report = (ids, need) => {
    if (!isOpen(ids, need.questionId)) return;
    const news = describeNeed(need, { agentLabel: agentLabel(), taskTitle: titleOf(ids) || '' });
    if (announce(news)) return;
    const due = () => isOpen(ids, need.questionId);
    // A call back already waits for the tab to show: this request goes with it.
    if (seen.join(news, { asks: true, due })) return;
    if (!callBackDue() || !canCallBack()) return;
    seen.callBack(news, { asks: true, due });
  };
  return {
    note(taskIds, steps) {
      const ids = (taskIds || []).filter(Boolean);
      if (!ids.some(hasCallWork)) return;
      openNeeds(steps, { prefs: prefs() }).forEach((need) => {
        if (considered.has(need.questionId)) return;
        considered.add(need.questionId);
        setTimeout(() => report(ids, need), graceMs);
      });
    },
  };
}

/**
 * The operator's actions that answer what Anton waits on, as the person's own
 * click on its card would: `browser_done` (the hand-over card's Done,
 * continue), `cancel_step` (a held step's Cancel) and `answer_question` (one
 * of its options). None approves a held browser step: that is the person's
 * click on the screen alone.
 *
 * @param {{
 *   taskOf: (taskId: string) => { id: string, title?: string, messages?: Array<object> },
 *   stepsOf: (taskId: string) => Array<object> | undefined,
 *   sessionOf: (task: object, steps: Array<object> | undefined) => string | null,
 *   handBack: (sessionId: string | null) => Promise<'sent' | 'waiting' | 'none'>,
 *   showBrowser: (task: object, sessionId: string) => void,
 *   decline: (questionId: string) => Promise<unknown>,
 *   submit: (conversationId: string, questionId: string, answer: object) => Promise<{ status?: string }>,
 *   agentLabel?: string,
 * }} deps
 */
export function callNeedActions({ taskOf, stepsOf, sessionOf, handBack, showBrowser, decline, submit, agentLabel = 'Anton' }) {
  const needIn = (task, kind) => openNeeds(stepsOf(task.id)).find((n) => n.kind === kind);
  const failed = (result) => result?.status === 'error' || result?.status === 'rejected';
  return {
    browser_done: async ({ task_id: taskId }) => {
      const task = taskOf(taskId);
      if (!needIn(task, 'handOver')) return `Nothing in "${task.title}" is waiting on the browser.`;
      const sessionId = sessionOf(task, stepsOf(task.id));
      const sent = await handBack(sessionId);
      if (sent === 'none') return `"${task.title}" has no browser to hand back.`;
      /* The web viewer takes the hand-back once the pane shows it, which may
         not happen (the pane can't open, or is closed first): the call says
         it hasn't gone yet. */
      if (sent === 'waiting') {
        showBrowser(task, sessionId);
        return `Opening the browser in "${task.title}" to hand it back: it goes once the browser shows, `
          + `then ${agentLabel} carries on. If it doesn't open, they can click Done in the browser.`;
      }
      return `Handed the browser back in "${task.title}": ${agentLabel} carries on.`;
    },
    // Cancels the held step the task has open, as its card's Cancel.
    cancel_step: async ({ task_id: taskId }) => {
      const task = taskOf(taskId);
      const need = needIn(task, 'approval');
      if (!need) return `Nothing in "${task.title}" is waiting for an approval.`;
      await decline(need.questionId);
      const result = await submit(task.id, need.questionId, { values: [APPROVAL_CANCEL_VALUE] });
      if (failed(result)) throw new Error("the cancel didn't go through");
      /* The card was answered first, maybe approved on the screen a moment
         ago: nothing was cancelled, and the step may already have run. */
      if (result?.status === 'not_found' || result?.status === 'already_answered') {
        return 'That step was already answered on the screen; the screen shows what happened.';
      }
      return `Cancelled: ${agentLabel} doesn't take that step.`;
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
