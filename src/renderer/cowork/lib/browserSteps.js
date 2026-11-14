/* The agent's browser in a turn's steps.

   Each call of the agent's browser tool is a step of its own
   (BROWSER_ACTION_BADGE), labelled from what the call asks: a run's goal, the
   site it opens, or what it does on the page. With Only show the browser when
   I'm needed on (Settings > Shared browser, lib/browserPrefs.js), a turn's
   browser steps show as one Browser row whose label follows the latest call
   (groupBrowserSteps), and the pane opens by itself only when it is the
   person's turn (browserApproval.js isPersonsBrowserTurn). A step the person
   approved or cancelled before that row follows it as a line of its own. */

import { BROWSER_BADGE, browserSessionIdIn } from './browserSession';
import i18n from '../../lib/i18n';

const tr = (key, vars) => i18n.t(`messages.browserSteps.${key}`, { ns: 'projects', ...vars });

export const BROWSER_ACTION_BADGE = 'BrowserAction';
// The agent's browser tool, as its calls are named in the stream.
export const BROWSER_TOOL = 'browser';
const MAX_GOAL_CHARS = 120;

function siteOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * A browser call's label, from its arguments: a run's goal, the site it
 * opens, or what it does on the page.
 *
 * @param {Record<string, any> | null | undefined} args
 * @returns {string}
 */
export function browserActionLabel(args) {
  const action = args?.action;
  const goal = typeof args?.goal === 'string' ? args.goal.replace(/\s+/g, ' ').trim() : '';
  if (action === 'run' && goal) return goal.length > MAX_GOAL_CHARS ? `${goal.slice(0, MAX_GOAL_CHARS - 1)}…` : goal;
  const site = siteOf(args?.url || (args?.step?.action === 'navigate' ? args.step.url : ''));
  if (site) return tr('open', { site });
  if (action === 'page') return tr('read');
  if (action === 'screenshot') return tr('look');
  if (action === 'act') return tr('act');
  if (action === 'hand_to_user') return tr('handOver');
  return tr('generic');
}

/** The step a browser call starts with, before its arguments are known. */
export function browserActionStep({ id, toolUseId, at }) {
  return {
    id,
    label: tr('generic'),
    badge: BROWSER_ACTION_BADGE,
    icon: 'globe',
    status: 'in_progress',
    startedAt: at,
    completedAt: null,
    data: null,
    output: null,
    result: null,
    _isScratchpad: false,
    _isToolCall: false,
    _toolUseId: toolUseId,
  };
}

export const isBrowserRow = (step) => step?.badge === BROWSER_BADGE || step?.badge === BROWSER_ACTION_BADGE;

/**
 * A turn's steps with its browser steps (the Browser step and each browser
 * call) as one Browser row, where the last of them was: labelled by the
 * latest call, running while any is, and opening the turn's browser when
 * clicked. A step `follows` picks out (an answered held step's card,
 * browserStepPrompt.js answeredBrowserStep) moves from before that row to
 * right after it, so the browser's work reads as one row and its approvals
 * under it. Anything else stays as it is.
 *
 * @param {Array<object>} steps
 * @param {{ follows?: (step: object) => unknown }} [options]
 * @returns {Array<object>}
 */
export function groupBrowserSteps(steps, { follows = () => false } = {}) {
  const list = Array.isArray(steps) ? steps : [];
  const members = list.filter(isBrowserRow);
  if (members.length < 2) return list;
  const latest = members.filter((s) => s.badge === BROWSER_ACTION_BADGE).at(-1) || members.at(-1);
  const running = members.some((s) => s.status === 'in_progress');
  const ends = members.map((s) => s.completedAt).filter((t) => typeof t === 'number');
  const group = {
    id: `browser-group-${members[0].id}`,
    label: latest.label,
    badge: BROWSER_BADGE,
    icon: 'globe',
    status: running ? 'in_progress' : 'completed',
    startedAt: members[0].startedAt,
    completedAt: running || !ends.length ? null : Math.max(...ends),
    data: { sessionId: browserSessionIdIn(members) },
    output: null,
    result: null,
    ...(latest.cellStatus ? { cellStatus: latest.cellStatus } : null),
  };
  const last = list.lastIndexOf(members.at(-1));
  const answered = list.filter((step, i) => i < last && follows(step));
  return list.flatMap((step, i) => {
    if (i === last) return [group, ...answered];
    return isBrowserRow(step) || answered.includes(step) ? [] : [step];
  });
}
