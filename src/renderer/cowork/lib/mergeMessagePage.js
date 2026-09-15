// Merges a freshly-fetched page of messages into the locally-held array
// (ENG-2768). Once /items is paginated, a plain wholesale replace at every
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
