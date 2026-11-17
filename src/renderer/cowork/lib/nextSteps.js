/*
 * The next steps offered under a finished answer: two or three buttons chosen
 * by what the turn made, so a second turn needs no typing.
 *
 * An artifact's own card already offers Preview and Share, so they are never
 * repeated here; a turn whose only next steps those are gets no row at all.
 *
 * The result kinds are read from what the client holds, never from the
 * agent's own words: an example start (the first message is a known example
 * prompt), files attached to the message the turn answered, an artifact, and
 * in the reply a Markdown table or two or more distinct web links.
 */

import { classifyStart } from '../components/onboarding/completion';
import { exampleForMessage, exampleTakesOwnData } from '../components/taskmodes/taskModes';

export const NEXT_STEP = Object.freeze({
  OWN_DATA: 'own_data',
  ANOTHER_FILE: 'another_file',
  MAKE_PAGE: 'make_page',
  SCHEDULE: 'schedule',
});

export const RESULT_KIND = Object.freeze({
  EXAMPLE: 'example',
  FILE: 'file',
  ARTIFACT: 'artifact',
  TABLE: 'table',
  RESEARCH: 'research',
  OTHER: 'other',
});

const MAX_STEPS = 3;

/* The message text a step sends. It is the agent's input, so it stays in
   English like the checklist and example prompts. */
export const NEXT_STEP_PROMPTS = Object.freeze({
  [NEXT_STEP.OWN_DATA]: 'Do the same with my own data. I attached it.',
  [NEXT_STEP.ANOTHER_FILE]: 'Do the same with this file.',
  [NEXT_STEP.MAKE_PAGE]: 'Turn this into a web page I can share.',
});

/** Steps that ask for files before anything is sent. */
export const FILE_STEPS = new Set([NEXT_STEP.OWN_DATA, NEXT_STEP.ANOTHER_FILE]);

// History replays can prefix a message with its send time.
const TIMESTAMP_PREFIX = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]\s*/;

function messageText(content) {
  if (typeof content === 'string') return content.replace(TIMESTAMP_PREFIX, '');
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('').replace(TIMESTAMP_PREFIX, '');
  }
  return '';
}

// A GFM table: a pipe row followed by its delimiter row.
const TABLE_RE = /^\s*\|.*\|\s*\n\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/m;
const LINK_RE = /https?:\/\/[^\s)\]>"']+/g;

export function hasMarkdownTable(text) {
  return typeof text === 'string' && TABLE_RE.test(text);
}

export function distinctLinkCount(text) {
  if (typeof text !== 'string') return 0;
  const urls = new Set((text.match(LINK_RE) || []).map((u) => u.replace(/[.,;:!?]+$/, '')));
  return urls.size;
}

export function turnHasArtifact(message) {
  if (message?.artifact) return true;
  return (message?.steps || []).some((s) => s?.badge === 'Artifact');
}

export function hasOpenQuestion(steps) {
  return (steps || []).some((s) => s?.badge === 'AskUser' && !s.data?.answer);
}

/**
 * Which result kinds a turn is, in order of priority. The first is the one
 * analytics reports as `result_kind`.
 *
 * @param {object} turn
 * @param {string} turn.firstUserText The conversation's first message.
 * @param {object | null} turn.userMessage The message this turn answered.
 * @param {boolean} turn.isFirstTurn Whether that message is the first one.
 * @param {object} turn.answer The finished assistant message.
 */
export function resultKinds({ firstUserText = '', userMessage = null, isFirstTurn = false, answer = {} } = {}) {
  const kinds = [];
  if (isFirstTurn && classifyStart(messageText(firstUserText)).start_kind === 'example') kinds.push(RESULT_KIND.EXAMPLE);
  if ((userMessage?.attachments || []).length > 0) kinds.push(RESULT_KIND.FILE);
  if (turnHasArtifact(answer)) kinds.push(RESULT_KIND.ARTIFACT);
  const reply = messageText(answer?.content);
  if (hasMarkdownTable(reply)) kinds.push(RESULT_KIND.TABLE);
  if (distinctLinkCount(reply) >= 2) kinds.push(RESULT_KIND.RESEARCH);
  if (kinds.length === 0) kinds.push(RESULT_KIND.OTHER);
  return kinds;
}

/**
 * The next steps for a finished turn, at most three, or none.
 *
 * @param {object} turn See resultKinds.
 * @param {{ canSchedule?: boolean, canAttach?: boolean }} [can] What this
 *   surface can do: open the schedule form, and send files.
 * @returns {{ resultKind: string, steps: string[] }}
 */
export function nextStepsFor(turn, { canSchedule = true, canAttach = true } = {}) {
  const kinds = resultKinds(turn);
  const has = (kind) => kinds.includes(kind);
  const hasFiles = has(RESULT_KIND.FILE);
  const steps = [];
  // Only an example that worked on made-up data or a document has something
  // of the person's to swap in; a game or an app does not.
  const ownData = has(RESULT_KIND.EXAMPLE)
    && exampleTakesOwnData(exampleForMessage(messageText(turn?.firstUserText)));
  if (canAttach && ownData) steps.push(NEXT_STEP.OWN_DATA);
  if (canAttach && hasFiles && !has(RESULT_KIND.EXAMPLE)) steps.push(NEXT_STEP.ANOTHER_FILE);
  // A page or a schedule follows from findings written in the reply. When the
  // turn already made an artifact, that artifact is the page.
  if ((has(RESULT_KIND.TABLE) || has(RESULT_KIND.RESEARCH)) && !has(RESULT_KIND.ARTIFACT)) {
    steps.push(NEXT_STEP.MAKE_PAGE);
    // A schedule re-runs the message on its own: it has to be the
    // conversation's first, so it needs no earlier turns, and carry no files,
    // which a schedule cannot attach again.
    if (canSchedule && turn?.isFirstTurn && !hasFiles) steps.push(NEXT_STEP.SCHEDULE);
  }
  return { resultKind: kinds[0], steps: steps.slice(0, MAX_STEPS) };
}

/**
 * Whether a finished assistant message gets next steps at all: the latest
 * answer, nothing in flight, nothing waiting on the person, and it finished.
 */
export function offersNextSteps({ isLatest, inFlight, answer, followedByFailure = false }) {
  if (!isLatest || inFlight || followedByFailure) return false;
  if (!answer || answer.role !== 'assistant') return false;
  if (answer.incompleteReason) return false;
  if (!answer.content && !turnHasArtifact(answer)) return false;
  return !hasOpenQuestion(answer.steps);
}

/** The text a schedule made from this turn runs: the message it answered. */
export function scheduledPromptFor(userMessage) {
  return messageText(userMessage?.content).trim();
}
