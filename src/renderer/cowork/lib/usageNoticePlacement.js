// Where an in-chat usage alert sits in the transcript (ENG-2747).
//
// A usage notice is a record of a moment: "while this ran, the allowance
// crossed a threshold". Appending the cards after the turns made them follow
// the bottom of the conversation, so once the user topped up and kept working
// the cards slid below the newer messages and read as a claim about now.
//
// Placement is anchored to the turn the crossing happened in, stamped when the
// notice is created. The transcript's own rows are no help here: messages come
// back from the server as `created_at` and are never mapped to `createdAt`, so
// a message's time is undefined at render and cannot order anything. The user
// turn ordinal is stable across hydration, re-render and streaming.
//
// A notice anchors AFTER its turn — it renders just before the next user
// message, so it never lands between a question and its reply, and a crossing
// that genuinely is the most recent event still comes last because nothing
// follows it yet.

// 0-based index of the turn currently being answered: the user message the
// in-flight reply belongs to. Stamped onto the notice at creation.
export function currentTurnIndex(messages) {
  const count = (Array.isArray(messages) ? messages : []).filter((m) => m?.role === 'user').length;
  return count - 1;
}

// Row index each notice renders before, bucketed. `buckets[i]` holds the
// notices that render immediately before `messages[i]`; the extra trailing
// bucket holds those that belong at the end of the transcript.
export function usageNoticeBuckets(messages, notices) {
  const rows = Array.isArray(messages) ? messages : [];
  const buckets = Array.from({ length: rows.length + 1 }, () => []);
  for (const n of Array.isArray(notices) ? notices : []) {
    buckets[_anchorRow(rows, n?.turnIndex)].push(n);
  }
  return buckets;
}

// The row that starts the turn AFTER the one the notice happened in. A notice
// with no turn stamp (created before this shipped, or by a path that doesn't
// know the turn) falls back to the end of the transcript — the old behaviour,
// which is right for the common case of a crossing that just happened.
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
