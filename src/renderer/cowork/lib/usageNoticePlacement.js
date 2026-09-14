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

// A turn the ordinal counts. Every user message except one the server will
// never see: a preflight that found no provider appends the typed message and
// its card locally and stops there. Counting it would put every later stamp one
// turn ahead of the server's numbering, and hydration — which rebuilds the
// transcript from the server and drops the unsent row — would stale them all.
const isAnchorTurn = (m) => m?.role === 'user' && !m?._unsent;

// How many turns a transcript holds.
export function userTurnCount(messages) {
  return (Array.isArray(messages) ? messages : []).filter(isAnchorTurn).length;
}

// 0-based index of the turn being answered. Stamped onto the notice at creation.
export function currentTurnIndex(messages) {
  return userTurnCount(messages) - 1;
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
    if (!isAnchorTurn(rows[i])) continue;
    userOrdinal += 1;
    if (userOrdinal > turnIndex) return i;
  }
  return rows.length;
}

// ── Re-anchoring when a turn is deleted ──────────────────────────────────
//
// The anchor is an ordinal, so a deleted turn moves the ground under it.
// `performDeleteTurn` rehydrates `messages` but carries `usageNotices` over
// untouched.
//
// Both repairs read the cut that HAPPENED, never the turn that was asked for.
// The two differ: the local walk finds its row by an assistant ordinal while
// the caller passes a user one, and the server counts visible assistant rows
// its own way. An `error` row between them makes either cut wider than the
// request, and a repair trusting the request then leaves a notice stranded —
// pinned to the bottom, which is the defect this placement exists to fix.

// Truncation: nothing from `survivingTurns` on is left to anchor to.
export function dropNoticesFromTurn(notices, survivingTurns) {
  if (!Array.isArray(notices) || !Number.isFinite(survivingTurns)) return notices;
  // An unstamped notice already anchors to the bottom. Left alone, not guessed at.
  return notices.filter((n) => !Number.isFinite(n?.turnIndex) || n.turnIndex < survivingTurns);
}

// A cut through the middle: `count` turns from `fromTurn` are gone and the
// conversation closes over the gap. Their notices go, and later ones shift down
// by as many turns as actually went.
export function removeNoticeTurns(notices, fromTurn, count) {
  if (!Array.isArray(notices) || !Number.isFinite(fromTurn) || !Number.isFinite(count)) return notices;
  if (count <= 0) return notices;
  const end = fromTurn + count;
  return notices
    .filter((n) => !Number.isFinite(n?.turnIndex) || n.turnIndex < fromTurn || n.turnIndex >= end)
    .map((n) => (Number.isFinite(n?.turnIndex) && n.turnIndex >= end
      ? { ...n, turnIndex: n.turnIndex - count }
      : n));
}
