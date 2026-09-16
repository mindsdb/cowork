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
// The id-less rows hydration derives from a failed turn. Deliberately narrow:
// an optimistic send and the live stub are also id-less, and they are content
// the page genuinely does not have yet.
const _isSyntheticCard = (m) => m?.id == null
  && (m?.role === 'error' || m?.role === 'provider_required');

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
  let trailingLocal = existingArr[lastIdIdx]?.id === withId[withId.length - 1].id
    ? existingArr.slice(lastIdIdx + 1)
    : [];

  // A failed turn is usually the NEWEST turn, so its synthetic
  // error/provider_required card sits after the last id-bearing row in the
  // page and in local state alike. Both describe the same failure, so keeping
  // both appends one more card per merge, forever — one extra every time the
  // task is reopened. Drop as many leading synthetic rows from the local tail
  // as the page supplies for that same position, and no more: anything past
  // that (an optimistic send, the live stub) is genuinely newer.
  let pageTrailingSynthetic = 0;
  for (let i = freshArr.length - 1; i >= 0 && freshArr[i]?.id == null; i--) pageTrailingSynthetic += 1;
  let superseded = 0;
  while (superseded < trailingLocal.length
    && superseded < pageTrailingSynthetic
    && _isSyntheticCard(trailingLocal[superseded])) superseded += 1;
  trailingLocal = trailingLocal.slice(superseded);

  // The live `_streaming` stub is render state, not history — the stream's
  // own lifecycle removes it, never a fetch. A refetch landing mid-turn must
  // not make the row the user is watching disappear, so it survives even when
  // the page has moved past the row it was trailing.
  const liveStub = trailingLocal.some((m) => m?.role === '_streaming')
    ? []
    : existingArr.filter((m) => m?.role === '_streaming');

  return [...existingArr.slice(0, startIdx), ...freshArr, ...trailingLocal, ...liveStub];
}

// True when the fetched page shares no row with what is already loaded, so
// mergeMessagePage replaces local state wholesale rather than splicing. The
// pagination state has to know this: the boundary it was holding described
// the array that just got thrown away.
export function pageReplacesLocalHistory(existing, freshPage) {
  const existingArr = Array.isArray(existing) ? existing : [];
  const freshArr = Array.isArray(freshPage) ? freshPage : [];
  if (freshArr.length === 0) return false;
  const oldestFresh = freshArr.find((m) => m?.id != null);
  if (!oldestFresh) return false;
  // Nothing loaded (or nothing the server has ever seen) is the most complete
  // replacement there is, not an exception to it. A turn delete that cuts to
  // the top leaves exactly this: an empty array beside a cursor describing the
  // history that was just removed. Keeping that cursor makes the next "load
  // earlier" re-fetch and re-prepend rows already on screen.
  if (!existingArr.some((m) => m?.id != null)) return true;
  return !existingArr.some((m) => m?.id === oldestFresh.id);
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
  // Except when the page replaced local history outright: the boundary being
  // preserved belongs to the array that was just discarded, so keeping it
  // points the next "load earlier" at a cursor far newer than the oldest row
  // now loaded, and that page comes back already on screen.
  const replaced = pageReplacesLocalHistory(existingTask?.messages, freshPage?.messages);
  if (!replaced && existingTask && existingTask.hasMoreMessages != null) {
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
