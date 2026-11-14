/* A held browser step's card, read for its site and action.

   anton's browser tool asks to approve a step with a markdown prompt: a bold
   title, a line on what the step may commit, the page's address and the step
   in a code fence, and a line on what Approve does. The card and the turn's
   steps show the site and the action as pills instead of the fence
   (BrowserStepPills). A prompt in any other shape is shown as it is.

   A held typing step also carries the text it types (`typed`), which only
   the waiting card shows: the person approves a send or a payment's text
   there, and the page can't show it, since nothing is typed before Approve.
   The card marks each line break and tab where it falls (typedTextShown):
   each host can type a "\n" as the Enter key, which can send the text even
   with no "and press Enter". It names each invisible character too, so what
   the person reads is what is typed.

   Once answered, a held step's card is a step of the turn of its own
   (answeredBrowserStep): "Browser action approved" or "cancelled", with the
   same pills and never the typed text. A click by position's card stays out
   of sight, as before. */

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
const TYPE_INTO = new RegExp(`^type (${QUOTED}) into (.+)$`);
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
  if (into) text = `type into ${into[2]}`;
  else if (intoElement) text = `type into ${intoElement[1]}`;
  // Any other typing step that quotes something may be quoting the text.
  else if (/^type\b/.test(text) && /["']/.test(text)) text = 'type';
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

/**
 * The text a held typing step types, as anton words the step
 * (`type "<JSON string>" into <target>`, maybe `and press Enter`), or null
 * for any other step or a quote that isn't a JSON string.
 *
 * @param {string} step
 * @returns {string | null}
 */
export function browserStepTypedText(step) {
  const into = TYPE_INTO.exec(String(step || '').trim());
  if (!into) return null;
  try {
    const typed = JSON.parse(into[1]);
    return typeof typed === 'string' ? withoutFenceSplits(typed) : null;
  } catch {
    return null;
  }
}

/* anton's fence splits an HTML comment mark (`<!--`, `-->`) and, in a tilde
   fence, a run of tildes with a zero-width space, so the card shows its
   fence whole (anton/core/utils/scratchpad.py _fence). The step types the
   text without them: they come out here, so the card doesn't mark them. */
const withoutFenceSplits = (typed) => typed
  .replace(/<\u200b!--/g, '<!--')
  .replace(/--\u200b>/g, '-->')
  .replace(/~(?:\u200b~)+/g, (run) => run.replace(/\u200b/g, ''));

/* The characters the waiting card marks in a typed text. Each host types a
   "\n" as the Enter key (on the desktop, TYPED_KEYS in
   src/main/browser-input.ts, within the text's first KEYED_CHARS characters;
   on the web, the web pod's typeText), so a line break can send the text. A
   tab or a lone carriage return goes in as text. The card marks each where it
   falls, so none hides in blank space. */
const MARKED_CHARS = /\r\n|\r|\n|\t/g;
/* Characters that show as nothing, or turn the text around them: the control
   characters other than a tab, a line feed and a carriage return (MARKED_CHARS
   marks those, and its marks keep the tab and the line feed), a soft hyphen,
   the zero-width ones, the bidi controls, the line and paragraph separators,
   the Hangul fillers, the other format characters, the variation selectors
   past the sixteen emoji use, and the tag characters, which can spell a whole
   hidden text. A page could steer the agent into typing them, so what the
   person reads differs from what is typed (a right-to-left override turns
   "4321 8765" into "5678 1234" on screen). The card names each by its code
   point where it falls. The `u` flag matches a character past U+FFFF as one. */
const HIDDEN_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufeff\uffa0\ufff0-\ufffb\u{1bca0}-\u{1bca3}\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}]/gu;
const codePoint = (char) => `⟦U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}⟧`;

/**
 * A held step's typed text as the waiting card shows it: each line break
 * marked ⏎ and still breaking the line, each tab marked ⇥, and each
 * invisible character named by its code point (⟦U+202E⟧).
 *
 * @param {string} typed
 * @returns {string}
 */
export function typedTextShown(typed) {
  return typed
    .replace(MARKED_CHARS, (char) => (char === '\t' ? '⇥\t' : '⏎\n'))
    .replace(HIDDEN_CHARS, codePoint);
}

/**
 * Whether the waiting card marks anything in a typed text (a line break, a
 * tab or an invisible character).
 *
 * @param {string} typed
 * @returns {boolean}
 */
export const typedTextHasMarks = (typed) => typedTextShown(typed) !== typed;

/**
 * The site and action a held browser step's card names, and the text a typing
 * step types (`typed`, else null), or null when its prompt isn't in the shape
 * anton writes, or names no web address. Only the waiting card shows `typed`.
 *
 * @param {unknown} prompt
 * @returns {{ url: string, site: string, action: string, typed: string | null } | null}
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
  return { url, site: parsed.hostname.replace(/^www\./, ''), action, typed: browserStepTypedText(match[3]) };
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
  // The site and action only: the turn's steps never carry the typed text.
  const parsed = parseBrowserStepPrompt(data.prompt);
  const pills = parsed ? { url: parsed.url, site: parsed.site, action: parsed.action } : null;
  return {
    ...step,
    label: approved ? tr('approved') : tr('cancelled'),
    badge: BROWSER_APPROVAL_BADGE,
    icon: 'globe',
    status: 'completed',
    data: {
      approved,
      sessionId: browserApprovalIds(data.question_id)?.sessionId || null,
      pills,
    },
  };
}
