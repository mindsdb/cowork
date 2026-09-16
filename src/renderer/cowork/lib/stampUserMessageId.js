// Puts the persisted user Message's id, which arrives on `response.created`,
// onto the row the client appended optimistically when the message was sent.
//
// Until it lands that row has no id, and every consumer keyed on message id
// (turn delete, the localStorage step sidecar, the usage-notice anchor) is
// blind to the turn the user is actually looking at.
//
// Returns the same array when there is nothing to do, so a caller can use the
// identity to skip a state update.

// A send that never reached the server: a preflight with no provider appends
// the typed message locally and stops. The id belongs to a different row, and
// stamping it here would hand this one a delete affordance that cuts a real
// turn server-side. usageNoticePlacement excludes these for the same reason.
const isStampable = (m) => m?.role === 'user' && !m?._unsent;

export function stampUserMessageId(messages, userMessageId) {
  const rows = Array.isArray(messages) ? messages : [];
  if (!userMessageId) return rows;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!isStampable(rows[i])) continue;
    // The newest stampable row already has an id: either this landed once
    // already, or a refetch supplied it. Either way there is nothing here to
    // fill in, and an older row is a different turn.
    if (rows[i].id != null) return rows;
    const next = rows.slice();
    next[i] = { ...next[i], id: userMessageId };
    return next;
  }
  return rows;
}
