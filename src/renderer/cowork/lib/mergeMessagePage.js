// Merges a freshly-fetched page of messages into the locally-held array.
// Once /items is paginated, a plain wholesale replace at every
// refetch site would truncate a conversation the user has already scrolled
// back through via "load earlier" — this keeps that older, already-loaded
// prefix intact and only replaces the tail the fresh page actually covers.
//
// `freshPage` always comes from the server, so every element has a real
// `.id`. `existing` may also hold rows that can never have one: the live
// `_streaming` stub, an optimistic send, an `error`/`provider_required`
// card. Those can never be superseded by a fetch and must survive the
// merge regardless.
export function mergeMessagePage(existing, freshPage) {
  const existingArr = Array.isArray(existing) ? existing : [];
  const freshArr = Array.isArray(freshPage) ? freshPage : [];
  if (freshArr.length === 0) return existingArr;

  const freshIds = new Set(freshArr.filter((m) => m?.id != null).map((m) => m.id));
  // Drop anything the fresh page also covers -- it supersedes the stale
  // local copy. An id-less row can never be covered by a fetch, so it
  // always survives this filter.
  const nonOverlapping = existingArr.filter((m) => m?.id == null || !freshIds.has(m.id));

  // What's left splits into the older, already-loaded prefix and any
  // trailing local-only rows the fetch can't know about (e.g. a new turn
  // that started streaming after this fetch was kicked off). A
  // once-persisted row never loses its id and a live/local-only row is
  // always the newest content, so the first id-less row marks that
  // boundary.
  const firstLocalIdx = nonOverlapping.findIndex((m) => m?.id == null);
  const olderPrefix = firstLocalIdx === -1 ? nonOverlapping : nonOverlapping.slice(0, firstLocalIdx);
  const trailingLocal = firstLocalIdx === -1 ? [] : nonOverlapping.slice(firstLocalIdx);

  return [...olderPrefix, ...freshArr, ...trailingLocal];
}

// What a task's hasMoreMessages/messagesCursor should be after merging a
// freshly-fetched page into it via mergeMessagePage above.
//
// A page fetch is always bounded to the most recent N messages and reports
// hasMoreMessages/nextBefore relative to ITS OWN oldest row — it has no idea
// how much further back the array it's being merged into already extends.
// mergeMessagePage never touches an existing older prefix, so once a task's
// true oldest boundary has been established (by an earlier full load, or by
// "load earlier messages" extending it further), a later refresh of just the
// tail must not regress that boundary back to the fresh page's own, shallower
// one — that desyncs the cursor from what's actually loaded and makes the
// next "load earlier" click re-fetch and re-prepend a page that's already
// present. `existingTask.hasMoreMessages` is `null`/`undefined` only when no
// boundary has been established yet (a task straight off the sidebar list,
// or a brand-new conversation) — that's the one case where the fresh page's
// own values are adopted.
export function reconcilePaginationState(existingTask, freshPage) {
  if (existingTask && existingTask.hasMoreMessages != null) {
    return {
      hasMoreMessages: existingTask.hasMoreMessages,
      messagesCursor: existingTask.messagesCursor ?? null,
    };
  }
  return {
    hasMoreMessages: freshPage?.hasMoreMessages ?? false,
    messagesCursor: freshPage?.messagesCursor ?? null,
  };
}
