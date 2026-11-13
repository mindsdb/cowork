/* A held browser step's card, read for its site and action.

   anton's browser tool asks to approve a step with a markdown prompt: a bold
   title, a line on what the step may commit, the page's address and the step
   in a code fence, and a line on what Approve does. The card and the turn's
   steps show the site and the action as pills instead of the fence
   (BrowserStepPills). A prompt in any other shape is shown as it is.

   Once answered, a held step's card is a step of the turn of its own
   (answeredBrowserStep): "Browser action approved" or "cancelled", with the
   same pills. A click by position's card stays out of sight, as before. */

import { BROWSER_APPROVE_VALUE, browserApprovalIds, isBrowserStepCard, isPositionClickCard } from './browserApproval';
import i18n from '../../lib/i18n';

const tr = (key) => i18n.t(`askUser.browserStep.${key}`, { ns: 'chat' });

export const BROWSER_APPROVAL_BADGE = 'BrowserApproval';

// The title anton's commit hold card opens with, then its fence: the page's
// address on the first line, the step on the second. anton fences in tildes
// when the text holds three backticks.
const STEP_PROMPT = /^\s*\*\*Approve this browser step\?\*\*\s*\n[\s\S]*?\n(```|~~~)\n([^\n]+)\n([^\n]+)\n\1[ \t]*(?:\n[\s\S]*)?$/;

// A JSON string, as anton writes a typed text or a name: quotes inside it
// are escaped.
const QUOTED = '"(?:[^"\\\\]|\\\\.)*"';
const TYPE_INTO = new RegExp(`^type ${QUOTED} into (.+)$`);
const TYPE_INTO_ELEMENT = /^type (\[\d+\]) [\s\S]+$/;

/**
 * The step's action as its pill says it: the verb capitalised, and never the
 * text the step types, as the turn's browser steps never show it either.
 *
 * @param {string} step the step as anton words it, e.g. `click "Booking"`
 * @returns {string}
 */
export function browserStepAction(step) {
  let text = String(step || '').trim();
  const into = TYPE_INTO.exec(text);
  const intoElement = into ? null : TYPE_INTO_ELEMENT.exec(text);
  if (into) text = `type into ${into[1]}`;
  else if (intoElement) text = `type into ${intoElement[1]}`;
  // Any other typing step that quotes something may be quoting the text.
  else if (/^type\b/.test(text) && /["']/.test(text)) text = 'type';
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

/**
 * The site and action a held browser step's card names, or null when its
 * prompt isn't in the shape anton writes, or names no web address.
 *
 * @param {unknown} prompt
 * @returns {{ url: string, site: string, action: string } | null}
 */
export function parseBrowserStepPrompt(prompt) {
  const match = typeof prompt === 'string' ? STEP_PROMPT.exec(prompt) : null;
  if (!match) return null;
  const url = match[2].trim();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) return null;
  const action = browserStepAction(match[3]);
  if (!action) return null;
  return { url, site: parsed.hostname.replace(/^www\./, ''), action };
}

/**
 * An answered held step's card as a step of the turn: approved or cancelled
 * (a Cancel, a Skip or no answer all leave the page as it is), with the site
 * and action when its prompt names them. Null for any other step, and for a
 * click by position's card, which stays out of sight.
 *
 * @param {{ badge?: string, data?: any } | null | undefined} step
 * @returns {object | null}
 */
export function answeredBrowserStep(step) {
  const data = step?.data;
  if (step?.badge !== 'AskUser' || !data?.answer) return null;
  if (!isBrowserStepCard(data) || isPositionClickCard(data)) return null;
  const { answer } = data;
  const approved = answer.status === 'answered'
    && Array.isArray(answer.values) && answer.values.length === 1 && answer.values[0] === BROWSER_APPROVE_VALUE;
  return {
    ...step,
    label: approved ? tr('approved') : tr('cancelled'),
    badge: BROWSER_APPROVAL_BADGE,
    icon: 'globe',
    status: 'completed',
    data: {
      approved,
      sessionId: browserApprovalIds(data.question_id)?.sessionId || null,
      pills: parseBrowserStepPrompt(data.prompt),
    },
  };
}
