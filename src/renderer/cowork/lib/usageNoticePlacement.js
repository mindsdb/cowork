// Where an in-chat usage alert sits in the transcript.
//
// Each notice is stamped with the message it happened after and anchors
// there, rendering just before the next user message — so it never splits
// a question from its reply.
//
// Anchored by message id, not a counted turn ordinal. A counted
// ordinal undercounts on a partially-loaded (paginated) conversation —
// the array handed to `currentTurnAnchorId` at stamp time may only be the
// most recent page, not the whole history. An id survives regardless of
// how much of the conversation happens to be loaded.

// Turns the anchor can land on: every user row except one the server will
// never see. A preflight with no provider appends the typed message locally
// and stops; hydration later drops it, so anchoring to it would strand the
// notice on a row that's about to disappear.
const isAnchorTurn = (m) => m?.role === 'user' && !m?._unsent;

// The message id this turn's notice should anchor after — the last
// anchor-turn row currently in the array (the turn being answered).
// Stamped onto the notice at creation; null if there's nothing to anchor
// to yet (falls through to the trailing bucket, same as an unstamped
// notice always has).
//
// Only the LAST anchor-turn row counts as "the current turn". A notice is
// stamped mid-turn, and the live turn's user row gets its real id from
// `response.created` (see stampUserMessageId in App.jsx), which lands well
// before any usage threshold can be crossed — so in practice there is an id
// here to anchor on.
//
// If there somehow isn't one, this returns null rather than falling back to
// an earlier turn's id: null puts the notice in the trailing bucket, at the
// bottom, which is where a just-crossed threshold belongs anyway. Falling
// back would instead render it above the live question, attributed to a turn
// that already finished.
export function currentTurnAnchorId(messages) {
  const rows = Array.isArray(messages) ? messages : [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (isAnchorTurn(rows[i])) return rows[i].id ?? null;
  }
  return null;
}

// Notices bucketed by the row they render before; the extra trailing bucket
// belongs at the end.
export function usageNoticeBuckets(messages, notices) {
  const rows = Array.isArray(messages) ? messages : [];
  const buckets = Array.from({ length: rows.length + 1 }, () => []);
  for (const n of Array.isArray(notices) ? notices : []) {
    buckets[_anchorRow(rows, n?.anchorId)].push(n);
  }
  return buckets;
}

// The row starting the turn after the notice's own anchor. An unstamped
// notice, or one whose anchor row isn't in this array (not loaded, or
// already removed), falls back to the end — right for a crossing that
// just happened, and the safe default otherwise.
function _anchorRow(rows, anchorId) {
  if (anchorId == null) return rows.length;
  const anchorIdx = rows.findIndex((m) => m?.id === anchorId);
  if (anchorIdx === -1) return rows.length;
  for (let i = anchorIdx + 1; i < rows.length; i++) {
    if (isAnchorTurn(rows[i])) return i;
  }
  return rows.length;
}

// ── Re-anchoring when a turn is deleted ──────────────────────────────────
//
// delete_turn always removes "this turn and everything after" — never a
// cut through the middle that leaves later turns intact — so there is no
// "shift the remaining ones down" arithmetic to redo here: ids don't move,
// so a notice anchored to a surviving id just keeps working, and one
// anchored to a removed id is dropped. Usage notices are in-memory only,
// never persisted, so there's no migration concern for old numeric-keyed
// notices either — they don't survive a reload regardless.

// Drops any notice anchored to a message id that no longer survives.
// `removedIds` may be an array or a Set. An unstamped notice (no anchor
// id) already renders at the bottom and is left alone, not guessed at.
export function dropNoticesFromTurn(notices, removedIds) {
  if (!Array.isArray(notices)) return notices;
  const removed = removedIds instanceof Set ? removedIds : new Set(removedIds || []);
  if (removed.size === 0) return notices;
  return notices.filter((n) => n?.anchorId == null || !removed.has(n.anchorId));
}
