// Merges a freshly-fetched page of messages into the locally-held array.
// Once /items is paginated, a plain wholesale replace at every
// refetch site would truncate a conversation the user has already scrolled
// back through via "load earlier" — this keeps that older, already-loaded
// prefix intact and only replaces the tail the fresh page actually covers.
//
// A fetched page is a contiguous run of the newest server history, and it
// arrives already hydrated — so it carries its own id-less synthetic rows
// (an `error`/`provider_required` card after a failed turn) exactly where
// they belong. `existing` holds the same kind of rows, plus genuinely local
// ones a fetch cannot know about: the `_streaming` stub and an optimistic
// send that has not been answered yet.
//
// The page is therefore authoritative for everything from its own oldest row
// onward. Only two things around it survive: whatever sits strictly before
// that row (an older prefix pulled in by "load earlier"), and whatever sits
// strictly after the page's newest row (a turn that started after this fetch
// was kicked off).
//
// Position is resolved by the page's own first and last ids, never by
// "the first row without an id" — id-less rows appear mid-history, so using
// one as a structural boundary reorders older history below newer, strands a
// duplicate of the question the page already covers, and re-appends a
// hydrated error card on every merge.
export function mergeMessagePage(existing, freshPage) {
  const existingArr = Array.isArray(existing) ? existing : [];
  const freshArr = Array.isArray(freshPage) ? freshPage : [];
  if (freshArr.length === 0) return existingArr;
  if (existingArr.length === 0) return freshArr;

  const withId = freshArr.filter((m) => m?.id != null);
  // Nothing to anchor against: the page is all synthetic rows, which only
  // happens when it is empty of real history. Keep what we have.
  if (withId.length === 0) return existingArr;

  const startIdx = existingArr.findIndex((m) => m?.id === withId[0].id);
  // No overlap at all. Local state and the page are two disjoint runs with a
  // gap of unknown size between them, so joining them would render a hole as
  // though it were continuous history. The page plus its cursor is the
  // honest state; the gap is reachable again through "load earlier".
  if (startIdx === -1) return freshArr;

  const lastIdIdx = existingArr.reduce((acc, m, i) => (m?.id != null ? i : acc), -1);
  // Local rows only count as newer than the page when the last row the two
  // share really is the page's own newest. Otherwise the page already covers
  // them -- an optimistic user row whose turn the page has since persisted is
  // the common case, and keeping it would duplicate the question.
  const trailingLocal = existingArr[lastIdIdx]?.id === withId[withId.length - 1].id
    ? existingArr.slice(lastIdIdx + 1)
    : [];

  // The live `_streaming` stub is render state, not history — the stream's
  // own lifecycle removes it, never a fetch. A refetch landing mid-turn must
  // not make the row the user is watching disappear, so it survives even when
  // the page has moved past the row it was trailing.
  const liveStub = trailingLocal.some((m) => m?.role === '_streaming')
    ? []
    : existingArr.filter((m) => m?.role === '_streaming');

  return [...existingArr.slice(0, startIdx), ...freshArr, ...trailingLocal, ...liveStub];
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
