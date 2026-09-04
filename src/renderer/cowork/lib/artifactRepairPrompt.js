// Recognise the artifact-repair handoff that "Address with agent" sends.
//
// That prompt is written for the agent, not for a person: it carries an
// artifact id, a base revision, a repair id and the raw comment-thread JSON so
// the turn can find and edit the right source. Sent as an ordinary user
// message, it lands in the transcript as a wall of identifiers with the one
// human-meaningful part — what the reviewer actually asked for — buried in the
// middle of it.
//
// So the chat renders a card instead. The message text is left exactly as it
// is: the agent reads it, and rewriting it to suit the UI would change the
// contract for the sake of presentation.
//
// Parsing the text is deliberate, over tagging the message with metadata at
// send time: the transcript is re-hydrated from the server on every reload, so
// anything not in the text itself would have to survive persistence to keep the
// card after a refresh. The template is server-generated from a single site
// (`build_agent_repair` in cowork-server's artifact_revisions.py), so there is
// one shape to track, and a miss degrades to the plain text that renders today.

const PREFIX = 'Address this artifact review thread.';
const THREAD_LABEL = 'Complete comment thread:';

function field(text, label) {
  // Values never span lines in the template — `Selected element` is the only
  // free-form one and it comes from a CSS-ish selector or a fixed string.
  const match = new RegExp(`^${label}:[ \\t]*(.*)$`, 'm').exec(text);
  return match ? match[1].trim() : '';
}

// The reviewer's own words, which is the only part of the prompt a person
// wants to read back.
function parseThread(text) {
  const start = text.indexOf(THREAD_LABEL);
  if (start < 0) return [];
  const open = text.indexOf('[', start);
  const close = text.lastIndexOf(']');
  if (open < 0 || close <= open) return [];
  let raw;
  try {
    raw = JSON.parse(text.slice(open, close + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => ({
      author: entry?.author?.email || entry?.author?.name || '',
      text: typeof entry?.text === 'string' ? entry.text : '',
      createdAt: entry?.createdAt || '',
    }))
    .filter((entry) => entry.text);
}

/**
 * Parsed handoff, or null when this is an ordinary message.
 *
 * Null is the common case and the safe one — every caller falls back to
 * rendering the text as written.
 */
export function parseArtifactRepairPrompt(text) {
  if (typeof text !== 'string' || !text.startsWith(PREFIX)) return null;
  const artifactId = field(text, 'Artifact id');
  const repairId = field(text, 'Repair id');
  // Without these two the card cannot identify what it is describing or look up
  // where the work got to, and a card that can do neither is worse than the raw
  // text it replaced.
  if (!artifactId || !repairId) return null;
  const selector = field(text, 'Selected element');
  return {
    artifactId,
    repairId,
    sourcePath: field(text, 'Source path'),
    baseRevisionId: field(text, 'Base revision'),
    // The template writes this fixed string when the reviewer commented on the
    // artifact as a whole rather than selecting an element; it names no element,
    // so the card has nothing to show for it.
    selector: selector === 'General artifact feedback' ? '' : selector,
    thread: parseThread(text),
  };
}

// What the card says, per repair status. `queued` is the only one that means
// work is still happening; everything else is a resting state the reviewer
// acts on (or has already acted on) in the artifact window.
const STATUS_COPY = {
  queued:    { label: 'Making changes',            tone: 'busy' },
  ready:     { label: 'Changes ready to review',   tone: 'done' },
  accepted:  { label: 'Changes applied',           tone: 'done' },
  rejected:  { label: 'Changes discarded',         tone: 'idle' },
  no_change: { label: 'No changes were needed',    tone: 'idle' },
  conflict:  { label: 'Could not apply the changes', tone: 'warn' },
  cancelled: { label: 'Cancelled',                 tone: 'idle' },
};

/**
 * Status → what the card shows.
 *
 * `streaming` only matters before the first status lands: a handoff whose turn
 * is still running reads as "Making changes" even though nothing has written a
 * status yet. Once the server has an answer, that answer wins — a turn can keep
 * streaming after the repair is already `ready`.
 */
export function repairCardState(status, { streaming = false } = {}) {
  if (STATUS_COPY[status]) return STATUS_COPY[status];
  return streaming
    ? STATUS_COPY.queued
    // Unknown and not streaming: say what we know (a handoff was sent) rather
    // than claim an outcome we could not confirm.
    : { label: 'Sent to the agent', tone: 'idle' };
}

export default parseArtifactRepairPrompt;
