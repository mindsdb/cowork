// The chat turn a quick edit becomes when it needs the agent (ENG-4227), and
// the chat transcript's way back from it.
//
// The bar sends the user's own words plus which artifact they were looking at,
// which the bar knew and the chat would not:
//
//   <message>\n\n(About the artifact `<slug>`.)
//
// The agent reads that text as sent. The transcript shows the message with the
// suffix turned into a pill naming the artifact (parseQuickEditPrompt), and
// the bar finds the agent's reply to it (chatReplyFor).

const SUFFIX = /\n\n\(About the artifact `([^`\n]+)`\.\)$/;

/** Agent-facing, so not translated (like launchLiveAppPrompt). */
export function quickEditChatPrompt(artifact, message) {
  const name = artifact?.slug || artifact?.title || '';
  return name ? `${message}\n\n(About the artifact \`${name}\`.)` : message;
}

/**
 * `{ text, slug }` for a message that ends in exactly the bar's suffix, else
 * null. Only that shape, only at the end: any other text is the user's own.
 */
export function parseQuickEditPrompt(content) {
  if (typeof content !== 'string') return null;
  const match = content.match(SUFFIX);
  if (!match) return null;
  const text = content.slice(0, match.index);
  if (!text.trim()) return null;
  return { text, slug: match[1] };
}

const textOf = (message) => (typeof message?.content === 'string' ? message.content : '');

/** How many user messages in `messages` read exactly `prompt`. */
export function countUserPrompts(messages, prompt) {
  if (!Array.isArray(messages) || !prompt) return 0;
  return messages.filter((m) => m?.role === 'user' && textOf(m) === prompt).length;
}

const pendingQuestion = (steps) => Array.isArray(steps)
  && steps.some((s) => s?.badge === 'AskUser' && s.data && s.data.answer == null && s.status !== 'completed');

/**
 * The chat's answer to the bar's message: the reply after the user message
 * that is the (`before` + 1)th one reading `prompt`, where `before` is how many
 * there were when the bar sent it. Null until that message is in the chat.
 *
 *   { text, live, needsAnswer, failed }
 *
 * `live` while the turn streams (the `_streaming` row), `needsAnswer` while it
 * waits on a question card, `failed` when the turn ended in an error row.
 */
export function chatReplyFor(messages, prompt, before = 0) {
  if (!Array.isArray(messages) || !prompt) return null;
  let seen = 0;
  let at = -1;
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m?.role === 'user' && textOf(m) === prompt) {
      seen += 1;
      if (seen === before + 1) { at = i; break; }
    }
  }
  if (at < 0) return null;
  let text = '';
  let live = false;
  let needsAnswer = false;
  let failed = false;
  for (let i = at + 1; i < messages.length; i += 1) {
    const m = messages[i];
    if (m?.role === 'user') break;
    if (m?.role === '_streaming') {
      live = true;
      text = textOf(m) || text;
      needsAnswer = needsAnswer || pendingQuestion(m.steps);
    } else if (m?.role === 'assistant') {
      text = textOf(m) || text;
      needsAnswer = needsAnswer || pendingQuestion(m.steps);
    } else if (m?.role === 'error') {
      failed = true;
    }
  }
  return { text, live, needsAnswer, failed };
}
