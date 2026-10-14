// Decides how a conversation's scroll position should react to its visible
// message list changing, as `action`:
//   'hold'   — an older page was prepended; shift by scrollHeightDelta so the
//              reader's position stays put. A snap to the bottom there would
//              yank someone reading old history down to the live edge.
//   'end'    — a different conversation: go to the end.
//   'sent'   — the reader just sent a message: bring it to the top of the
//              view, whatever they were reading, with room for the answer.
//   'follow' — anything else at the end (a reply landing, a stream starting):
//              stay at the end only if the reader was already there.
//
// A prepend is detected by comparing the array's first message id across
// calls: unchanged (or this is the first call for this task) means
// whatever changed did so at/after the front is untouched, so falling
// through to "scroll to bottom" is correct (also covers a brand new task,
// where snapping to the bottom is exactly what opening a conversation
// should do); a different first id, with more messages than before, means
// something was prepended.
export function nextScrollAnchor({ taskId, messages, previousAnchor, scrollHeight }) {
  const firstKey = messages[0]?.id ?? null;
  const sameTask = previousAnchor?.taskId === taskId;
  const isPrepend = sameTask
    && previousAnchor.firstKey != null
    && firstKey != null
    && firstKey !== previousAnchor.firstKey
    && messages.length > (previousAnchor.messageCount ?? 0);
  // The rows added since last time include a user message. Not only the last
  // row: a thinking placeholder can land after it in the same update.
  const appendedUserMessage = sameTask
    && messages.length > (previousAnchor.messageCount ?? 0)
    && messages.slice(previousAnchor.messageCount ?? 0).some((m) => m?.role === 'user');
  let action = 'follow';
  if (isPrepend) action = 'hold';
  else if (!sameTask) action = 'end';
  else if (appendedUserMessage) action = 'sent';
  return {
    action,
    isPrepend,
    // previousAnchor.scrollHeight is the height as of the last time this
    // ran (before the prepend's content was added to the DOM); scrollHeight
    // here is the fresh value read after React committed the update. The
    // difference is exactly how many pixels of new content landed above
    // whatever was on screen, which scrollTop needs to shift by to hold
    // the reader's position steady.
    scrollHeightDelta: isPrepend ? scrollHeight - previousAnchor.scrollHeight : 0,
    anchor: { taskId, firstKey, messageCount: messages.length, scrollHeight },
  };
}
