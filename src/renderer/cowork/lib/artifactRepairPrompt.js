// Recognize cowork-server's build_agent_repair prompt to render a human-readable card without
// changing the agent's input.
// Parse persisted text so cards survive reloads; unrecognized templates fall back to the original
// text.

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

/** Return null for ordinary or unrecognized messages; callers render their original text. */
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
  // Distinct from `rejected`: the agent's revision stays in history, the owner
  // simply closed the review without applying or restoring it.
  discarded: { label: 'Suggestion dismissed',      tone: 'idle' },
};

/**
 * Server repair status takes precedence over streaming: the repair can be ready while its turn is
 * still running.
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
