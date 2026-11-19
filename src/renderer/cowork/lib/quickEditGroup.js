// Quick edits in the artifact's chat (ENG-4227). The server keeps one
// assistant message per burst of edits from the viewer's chat bar (harness
// `cowork-quick-edit`) and updates it in place as edits land. The message's
// only event is the group:
//
//   { type: 'response.quick_edit_group', kind: 'quick_edit_group',
//     artifactId, artifactSlug, artifactTitle,
//     edits: [{ editId, request, summary, changed, revisionId, at, model, undone }] }
//
// Its `content` is model-facing text and is never shown. Hydrating the
// messages API's items (api.js, lib/conversationHistory) keeps that event as
// `quickEditGroup` instead of replaying it as a turn (`withQuickEditGroup`),
// and the transcript renders it as one card (QuickEditGroupCard). Older
// conversations hold each edit as a user message plus an assistant note
// starting with LEGACY_PREFIX; those render as a one-edit card too.
//
// `groupEventOf` is the only place that knows where the group sits on a
// message, so the path is changed here and nowhere else.

export const QUICK_EDIT_HARNESS = 'cowork-quick-edit';
export const QUICK_EDIT_GROUP_KIND = 'quick_edit_group';
export const QUICK_EDIT_GROUP_EVENT = 'response.quick_edit_group';
export const LEGACY_PREFIX = 'I edited this artifact directly from its viewer (quick edit): ';

const isGroupEvent = (e) => !!e && typeof e === 'object'
  && e.type === QUICK_EDIT_GROUP_EVENT && e.kind === QUICK_EDIT_GROUP_KIND;

// A hydrated message keeps the event as `quickEditGroup`; a raw item from the
// messages API still has it in `events`.
function groupEventOf(message) {
  if (isGroupEvent(message?.quickEditGroup)) return message.quickEditGroup;
  return Array.isArray(message?.events) ? message.events.find(isGroupEvent) || null : null;
}

/**
 * A raw assistant item that is a quick-edit group, hydrated: its events
 * dropped and the group kept as `quickEditGroup`, with no steps, status or
 * answer text derived from it. Null for any other message, which then
 * hydrates as a turn.
 */
export function withQuickEditGroup(message) {
  if (message?.role !== 'assistant') return null;
  const event = groupEventOf(message);
  if (!event) return null;
  const { events: _drop, ...rest } = message;
  return { ...rest, quickEditGroup: event, _turnComplete: true };
}

const str = (v) => (typeof v === 'string' ? v : '');

function normalizeEdit(edit, index) {
  if (!edit || typeof edit !== 'object') return null;
  return {
    editId: str(edit.editId) || `edit-${index}`,
    request: str(edit.request),
    summary: str(edit.summary),
    changed: Array.isArray(edit.changed) ? edit.changed.filter((p) => typeof p === 'string') : [],
    revisionId: str(edit.revisionId) || null,
    at: str(edit.at) || null,
    model: str(edit.model) || null,
    undone: edit.undone === true,
  };
}

/** The group a message carries, normalized, or null for any other message. */
export function quickEditGroupOf(message) {
  if (message?.role !== 'assistant') return null;
  const meta = groupEventOf(message);
  if (!meta) return null;
  const edits = (Array.isArray(meta.edits) ? meta.edits : []).map(normalizeEdit).filter(Boolean);
  if (edits.length === 0) return null;
  return {
    artifactId: str(meta.artifactId) || null,
    artifactSlug: str(meta.artifactSlug) || null,
    artifactTitle: str(meta.artifactTitle) || null,
    edits,
  };
}

/**
 * An old one-edit note: the assistant text the server saved before groups,
 * as `{ summary, changed, revisionNumber }`, or null. Only that exact opening;
 * any other text is an ordinary answer.
 */
export function legacyQuickEditNote(message) {
  if (message?.role !== 'assistant') return null;
  const content = str(message.content);
  if (!content.startsWith(LEGACY_PREFIX)) return null;
  const lines = content.split('\n');
  const summary = lines[0].slice(LEGACY_PREFIX.length).trim();
  let changed = [];
  let revisionNumber = null;
  for (const line of lines.slice(1)) {
    const files = line.match(/^Files changed: (.+?)\.?$/);
    if (files) changed = files[1].replace(/ and \d+ more$/, '').split(', ').filter(Boolean);
    const rev = line.match(/^Saved as draft revision (\d+); not published\.$/);
    if (rev) revisionNumber = Number(rev[1]);
  }
  return { summary, changed, revisionNumber };
}

/**
 * The group an old note stands for, with the user message before it as the
 * request. The note names no artifact, so the card shows none.
 */
export function legacyQuickEditGroup(message, previous) {
  const note = legacyQuickEditNote(message);
  if (!note) return null;
  const request = previous?.role === 'user' ? str(previous.content) : '';
  return {
    artifactId: null,
    artifactSlug: null,
    artifactTitle: null,
    legacy: true,
    edits: [{
      editId: message?.id ? String(message.id) : 'legacy',
      request,
      summary: note.summary,
      changed: note.changed,
      revisionId: null,
      at: str(message?.created_at) || str(message?.createdAt) || null,
      model: null,
      undone: false,
    }],
  };
}

/** Whether the user message at `index` is folded into the old note after it. */
export function isFoldedLegacyRequest(messages, index) {
  const m = messages?.[index];
  return m?.role === 'user' && !!legacyQuickEditNote(messages[index + 1]);
}

const cardAt = (messages, i) => quickEditGroupOf(messages[i]) || legacyQuickEditGroup(messages[i], messages[i - 1]);

const artifactKey = (group) => group.artifactId || group.artifactSlug || null;

// Two cards can be one when they name the same artifact, or when either names
// none (an older note, which the server never tied to an artifact).
const compatible = (a, b) => {
  const ka = artifactKey(a);
  const kb = artifactKey(b);
  return !ka || !kb || ka === kb;
};

const timeOf = (edit) => {
  const t = edit.at ? Date.parse(edit.at) : NaN;
  return Number.isNaN(t) ? null : t;
};

function mergeGroups(parts) {
  const known = [...parts].reverse().find((p) => artifactKey(p)) || null;
  const edits = parts.flatMap((p) => p.edits);
  // Time order when every edit has a time; otherwise the transcript's order,
  // which is already the order they were saved in.
  const times = edits.map(timeOf);
  const ordered = times.every((t) => t !== null)
    ? edits.map((e, i) => [e, times[i], i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([e]) => e)
    : edits;
  return {
    artifactId: known?.artifactId || null,
    artifactSlug: known?.artifactSlug || null,
    artifactTitle: known?.artifactTitle || null,
    legacy: parts.every((p) => p.legacy),
    edits: ordered,
  };
}

/**
 * How the transcript draws quick edits: adjacent cards merged into one.
 *
 * Cards are adjacent when nothing but an older note's own request sits
 * between them (no other user message or answer). Server groups merge when
 * they are for the same artifact; older notes, which name none, merge with
 * any neighbour. The merged card is drawn at its first message and takes the
 * artifact from whichever part names it.
 *
 * Returns `{ cards: Map<index, group>, hidden: Set<index> }`: draw `cards`
 * at their index, and nothing for an index in `hidden` (a merged card's later
 * parts and every folded request).
 */
export function planQuickEditCards(messages) {
  const cards = new Map();
  const hidden = new Set();
  if (!Array.isArray(messages)) return { cards, hidden };
  let run = null; // { start, parts, merged }
  const close = () => {
    if (run) cards.set(run.start, mergeGroups(run.parts));
    run = null;
  };
  for (let i = 0; i < messages.length; i += 1) {
    if (isFoldedLegacyRequest(messages, i)) {
      // Part of the note after it: neither ends a run nor is drawn.
      hidden.add(i);
      continue;
    }
    const group = cardAt(messages, i);
    if (!group) {
      close();
      continue;
    }
    if (run && run.parts.every((p) => compatible(p, group))) {
      run.parts.push(group);
      hidden.add(i);
    } else {
      close();
      run = { start: i, parts: [group] };
    }
  }
  close();
  return { cards, hidden };
}
