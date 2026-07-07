// Pure realtime-merge logic for artifact comment threads (Plan 5).
//
// A thread is the inference row: { id, selector, status, version, updated_at,
// payload: { author:{email}, text, replies:[{author:{email}, text, created_at}] } }.
// SSE events carry the whole updated thread + a `type`; clients upsert by id and
// ignore any event whose version is <= the one they already hold (idempotent,
// reorder-safe). Kept pure so it's trivially testable.

export function upsertThread(threads, event) {
  const list = threads || [];
  const id = event && event.id;
  if (!id) return list;
  const idx = list.findIndex((t) => t.id === id);
  if (event.type === 'thread.deleted') {
    if (idx === -1) return list;
    const next = list.slice();
    next.splice(idx, 1);
    return next;
  }
  if (idx === -1) return [...list, event];
  if ((event.version || 0) <= (list[idx].version || 0)) return list; // stale/dup
  const next = list.slice();
  next[idx] = event;
  return next;
}

// Max updated_at (ISO string) across the loaded threads — the `since` cursor for
// the SSE replay that closes the load→subscribe gap.
export function maxUpdatedAt(threads) {
  let m = '';
  (threads || []).forEach((t) => {
    if (t.updated_at && t.updated_at > m) m = t.updated_at;
  });
  return m;
}

// View helpers so the UI reads a stable shape regardless of payload nesting.
export function threadText(t) {
  return (t && t.payload && t.payload.text) || '';
}
export function threadAuthorEmail(t) {
  return (t && t.payload && t.payload.author && t.payload.author.email) || '';
}
export function threadReplies(t) {
  return (t && t.payload && t.payload.replies) || [];
}
export function replyAuthorEmail(r) {
  return (r && r.author && r.author.email) || '';
}

// ISO8601 (inference) -> epoch seconds; numbers pass through. The on-artifact
// layer renders relative times off epoch seconds.
export function isoToEpoch(s) {
  if (typeof s === 'number') return s;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

// Flatten an inference thread into the shape the injected marker layer renders
// (see cowork-server comments_layer.py). The layer is credential-free and only
// ever receives this pre-normalized shape over postMessage.
export function normalizeThreadForLayer(t) {
  return {
    id: t.id,
    selector: t.selector,
    status: t.status,
    author: threadAuthorEmail(t),
    text: threadText(t),
    // Prefer the thread's own creation time so the marker popover timestamp is
    // stable; fall back to updated_at when the backend omits created_at (it
    // otherwise jumps forward on every reply/status change).
    created_at: isoToEpoch(t.created_at || t.updated_at),
    replies: threadReplies(t).map((r) => ({
      author: replyAuthorEmail(r),
      text: r.text || '',
      created_at: isoToEpoch(r.created_at),
    })),
  };
}
