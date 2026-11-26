// A comment sent to the agent from the inbox, as a message for the artifact's
// "Ask for a change" bar (ENG-4383): where the comment sits, then the thread,
// words only; the thread's images go with the message as attachments
// (lib/commentImages). The bar's request is capped at 4,000 characters
// (cowork-server quick edits), so a long thread is cut from its end.

import { parseCommentText } from './commentImages';
import { threadReplies, threadText } from './commentsReducer';
import i18n from '../../lib/i18n';

export const MAX_REQUEST_CHARS = 4000;

const tr = (key, vars) => i18n.t(`quickEdit.comment.${key}`, { ns: 'artifacts', ...vars });

// The selector is a CSS path for a comment on an element, a JSON anchor (a
// text range, a doc's blocks) for one on a place, quoting the words picked
// there, or empty for one on the whole artifact.
function anchorLine(selector) {
  if (!selector) return tr('onArtifact');
  try {
    const anchor = JSON.parse(selector);
    if (anchor && typeof anchor === 'object') {
      return anchor.quote
        ? tr('onText', { quote: String(anchor.quote).replace(/\s+/g, ' ').slice(0, 300) })
        : tr('onArtifact');
    }
  } catch { /* a CSS path */ }
  return tr('onElement', { selector: String(selector).slice(0, 300) });
}

/** The bar message for `thread`. */
export function commentFixMessage(thread) {
  const lines = [anchorLine(thread?.selector)];
  const entries = [threadText(thread), ...threadReplies(thread).map((reply) => reply?.text)];
  for (const text of entries) {
    const body = parseCommentText(text || '').body.trim();
    if (body) lines.push(`> ${body.replace(/\n/g, '\n> ')}`);
  }
  const message = lines.join('\n');
  return message.length > MAX_REQUEST_CHARS ? `${message.slice(0, MAX_REQUEST_CHARS - 1)}…` : message;
}
