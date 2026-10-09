// Decides how a conversation's scroll position should react to its visible
// message list changing. Appending new content at the end (a
// live stream, a new turn finishing) keeps the existing "snap to bottom"
// behavior; prepending an older page (the "load earlier messages"
// affordance) must instead preserve the reader's current position — a
// snap-to-bottom there would yank someone reading old history down to the
// live edge every time they load more.
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
  return {
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
