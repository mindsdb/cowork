// Where an in-chat usage alert sits in the transcript.
//
// Each notice is stamped with the turn it happened in and anchors after that
// turn, rendering just before the next user message — so it never splits a
// question from its reply. Message rows cannot order it: none carries a usable
// timestamp at render. The ordinal survives hydration, re-render and streaming.

// Turns the ordinal counts: every user row except one the server will never
// see. A preflight with no provider appends the typed message locally and
// stops; hydration later drops it, so counting it would stale every stamp.
const isAnchorTurn = (m) => m?.role === 'user' && !m?._unsent;

export function userTurnCount(messages) {
  return (Array.isArray(messages) ? messages : []).filter(isAnchorTurn).length;
}

// 0-based index of the turn being answered. Stamped onto the notice at creation.
export function currentTurnIndex(messages) {
  return userTurnCount(messages) - 1;
}

// Notices bucketed by the row they render before; the extra trailing bucket
// belongs at the end.
export function usageNoticeBuckets(messages, notices) {
  const rows = Array.isArray(messages) ? messages : [];
  const buckets = Array.from({ length: rows.length + 1 }, () => []);
  for (const n of Array.isArray(notices) ? notices : []) {
    buckets[_anchorRow(rows, n?.turnIndex)].push(n);
  }
  return buckets;
}

// The row starting the turn after the notice's own. An unstamped notice falls
// back to the end, which is right for a crossing that just happened.
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
// Both repairs read the cut that HAPPENED, never the turn that was asked for.
// An `error` row makes either delete path cut wider than the request, and a
// repair trusting the request strands a notice at the bottom.

// Truncation: nothing from `survivingTurns` on is left to anchor to.
export function dropNoticesFromTurn(notices, survivingTurns) {
  if (!Array.isArray(notices) || !Number.isFinite(survivingTurns)) return notices;
  // An unstamped notice already anchors to the bottom. Left alone, not guessed at.
  return notices.filter((n) => !Number.isFinite(n?.turnIndex) || n.turnIndex < survivingTurns);
}

// A cut through the middle: `count` turns from `fromTurn` are gone and the
// conversation closes up. Their notices go; later ones shift down by `count`.
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
