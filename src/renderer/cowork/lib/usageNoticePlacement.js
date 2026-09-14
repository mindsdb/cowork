// Where an in-chat usage alert sits in the transcript.
//
// A notice records a moment: while this ran, the allowance crossed a
// threshold. Appending the cards after the turns made them follow the bottom of
// the conversation, so a card read after a top-up became a claim about now.
//
// Each notice is stamped with the turn it happened in. Message rows cannot
// order it: the server sends `created_at` and nothing maps it to `createdAt`,
// so a message's own time is undefined at render. The turn ordinal survives
// hydration, re-render and streaming.
//
// A notice anchors AFTER its turn, rendering just before the next user
// message. It therefore never splits a question from its reply, and a crossing
// that is genuinely the latest event still comes last.

// 0-based index of the turn being answered. Stamped onto the notice at creation.
export function currentTurnIndex(messages) {
  const count = (Array.isArray(messages) ? messages : []).filter((m) => m?.role === 'user').length;
  return count - 1;
}

// Notices bucketed by the row they render before: `buckets[i]` precedes
// `messages[i]`, and the extra trailing bucket belongs at the end.
export function usageNoticeBuckets(messages, notices) {
  const rows = Array.isArray(messages) ? messages : [];
  const buckets = Array.from({ length: rows.length + 1 }, () => []);
  for (const n of Array.isArray(notices) ? notices : []) {
    buckets[_anchorRow(rows, n?.turnIndex)].push(n);
  }
  return buckets;
}

// The row starting the turn after the notice's own. An unstamped notice falls
// back to the end — the old behaviour, still right for a crossing that just
// happened.
function _anchorRow(rows, turnIndex) {
  if (!Number.isFinite(turnIndex)) return rows.length;
  let userOrdinal = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.role !== 'user') continue;
    userOrdinal += 1;
    if (userOrdinal > turnIndex) return i;
  }
  return rows.length;
}

// ── Re-anchoring when a turn is deleted ──────────────────────────────────
//
// The anchor is an ordinal, so a deleted turn moves the ground under it.
// `performDeleteTurn` rehydrates `messages` but carries `usageNotices` over
// untouched. The two delete paths cut differently and each needs its own repair.

// The server cut takes the turn and everything after it. Those notices describe
// moments the conversation no longer contains, so they go with them.
export function dropNoticesFromTurn(notices, turnIndex) {
  if (!Array.isArray(notices) || !Number.isFinite(turnIndex)) return notices;
  // An unstamped notice already anchors to the bottom. Left alone, not guessed at.
  return notices.filter((n) => !Number.isFinite(n?.turnIndex) || n.turnIndex < turnIndex);
}

// The local (`tmp-`) cut takes one exchange and the conversation closes up. The
// deleted turn's notices go; later ones shift down to stay on their own turn.
export function shiftNoticesAfterTurn(notices, turnIndex) {
  if (!Array.isArray(notices) || !Number.isFinite(turnIndex)) return notices;
  return notices
    .filter((n) => !Number.isFinite(n?.turnIndex) || n.turnIndex !== turnIndex)
    .map((n) => (Number.isFinite(n?.turnIndex) && n.turnIndex > turnIndex
      ? { ...n, turnIndex: n.turnIndex - 1 }
      : n));
}
