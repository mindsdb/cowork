/* A browser hand-over's card, read for its site, reason and whether it comes
   back by itself.

   anton's browser tool hands the browser to the person (a sign-in, a CAPTCHA,
   a box only they may tick) with a `browser:` card whose prompt is one line,
   "Your turn on <host>: <reason>", then one of two lines:

     - "Use the browser beside the chat, and click Done in the browser when
       you're finished." The person hands it back with Done.
     - "Use the browser beside the chat. I'll carry on by myself once that's
       done, or click Done in the browser." The browser watches for what the
       hand-over waits for, and hands back by itself a few seconds after the
       person did it (`watching`).

   Its options are Finish later and Stop. anton retires the card itself, with
   the answer `done`, once the browser is handed back by any path: Done in the
   browser, the card's Done, continue, or by itself. The card never answers
   `done`: only the browser's own hand-back counts.

   Once answered, the card is a step of the turn of its own
   (answeredHandOverStep), as an answered approval is: "Handed back —
   continued", or Stopped. A card left for later, timed out, or no longer
   live stays a card while its turn is the latest one the person can reply
   to, since the browser is still theirs and its Done, continue carries the
   task on; in any older turn it folds too. */

import i18n from '../../lib/i18n';

const tr = (key) => i18n.t(`askUser.handOver.${key}`, { ns: 'chat' });

export const BROWSER_HANDOVER_BADGE = 'BrowserHandOver';
export const HANDOVER_DONE_VALUE = 'done';
export const HANDOVER_STOP_VALUE = 'stop';

const MANUAL = "Use the browser beside the chat, and click Done in the browser when you're finished.";
const WATCHING = "Use the browser beside the chat. I'll carry on by myself once that's done, or click Done in the browser.";
const NO_ADDRESS = 'Your turn on a page with no web address: ';
const HEAD = /^Your turn on ([^\s:]+): ([^\n]*)$/;

/**
 * The site, reason and whether it comes back by itself a hand-over card
 * names, or null when its prompt isn't in the shape anton writes.
 *
 * @param {unknown} prompt
 * @returns {{ site: string, reason: string, watching: boolean } | null}
 */
export function parseHandOverPrompt(prompt) {
  if (typeof prompt !== 'string') return null;
  const parts = prompt.split('\n\n');
  if (parts.length !== 2) return null;
  const [head, tail] = parts;
  const watching = tail === WATCHING;
  if (!watching && tail !== MANUAL) return null;
  if (head.startsWith(NO_ADDRESS)) {
    const reason = head.slice(NO_ADDRESS.length).trim();
    return reason && !reason.includes('\n') ? { site: '', reason, watching } : null;
  }
  const match = HEAD.exec(head);
  if (!match || !match[2].trim()) return null;
  return { site: match[1].replace(/^www\./, ''), reason: match[2].trim(), watching };
}

/**
 * Whether a question is a browser hand-over's card.
 *
 * @param {{ question_id?: string, prompt?: string } | null | undefined} data
 * @returns {boolean}
 */
export function isHandOverCard(data) {
  const id = String(data?.question_id || '');
  return id.startsWith('browser:') && !id.startsWith('browser:approve:') && parseHandOverPrompt(data?.prompt) !== null;
}

/**
 * A hand-over card as a step of the turn: handed back (`done`) or stopped
 * always, and anything else (left for later, a timeout, a card no longer
 * live) unless `stillTheirs`: it is the last question of the running turn or
 * of the latest turn the person can reply to, where the browser may still be
 * theirs and the card's Done, continue carries the task on. Null for any
 * other step, and for a card that still shows.
 *
 * @param {{ badge?: string, data?: any } | null | undefined} step
 * @param {{ stillTheirs?: boolean }} [where]
 * @returns {object | null}
 */
export function answeredHandOverStep(step, { stillTheirs = false } = {}) {
  const data = step?.data;
  if (step?.badge !== 'AskUser' || !isHandOverCard(data)) return null;
  const answer = data.answer || null;
  const value = answer?.status === 'answered' && Array.isArray(answer.values) ? answer.values[0] : null;
  const outcome = value === HANDOVER_DONE_VALUE ? 'done' : value === HANDOVER_STOP_VALUE ? 'stopped' : 'ended';
  if (outcome === 'ended' && stillTheirs) return null;
  const parsed = parseHandOverPrompt(data.prompt);
  return {
    ...step,
    label: tr(outcome === 'done' ? 'handedBack' : outcome),
    badge: BROWSER_HANDOVER_BADGE,
    icon: 'globe',
    status: 'completed',
    data: { outcome, site: parsed.site, reason: parsed.reason },
  };
}

/**
 * A hand-over card handed back or stopped, as its step: what follows the
 * turn's Browser row (lib/browserSteps.js). Null for anything else.
 *
 * @param {{ badge?: string, data?: any } | null | undefined} step
 * @returns {object | null}
 */
export function finishedHandOverStep(step) {
  const folded = answeredHandOverStep(step, { stillTheirs: true });
  return folded && folded.data.outcome !== 'ended' ? folded : null;
}
