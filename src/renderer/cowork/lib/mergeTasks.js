// Pure task-merge semantics for fetchSessions reconciliation, extracted from
// App.jsx so the rules are directly testable (ENG-1304, PR #580 review).
// The invariants that matter:
//   - local wins the live conversation surface while streaming
//   - updatedAt takes the newer of (local, server) so a mid-stream refresh
//     can't slide a just-revived task down the list (ENG-961)
//   - the per-task model pin is client-only state (the server always returns
//     model: null), so every merge path carries the local value
export function mergeTasksFromServer(serverTasks, localTasks) {
  const local = Array.isArray(localTasks) ? localTasks : [];
  if (!Array.isArray(serverTasks)) return local;
  const localById = new Map(local.map((t) => [t.id, t]));
  // Take whichever of (local, server) updatedAt is newer. When a turn
  // is in flight, handleSendInTask / handleSendFromHome stamp a fresh
  // client updatedAt the instant the user sends, but the server's value
  // only catches up once the turn's messages persist (the server derives
  // updated_at from the latest message — ENG-961). Keeping the newer of
  // the two stops a fetchSessions mid-stream from sliding the just-revived
  // task back down the list before the server value lands.
  const _newerUpdatedAt = (a, b) => {
    const aa = Date.parse(a || '') || 0;
    const bb = Date.parse(b || '') || 0;
    return aa >= bb ? a : b;
  };
  const merged = serverTasks.map((server) => {
    const l = localById.get(server.id);
    if (!l) return server;
    // The per-task model pin is client-only state — _conversationToTask
    // always returns model: null, so spreading `...server` below would wipe
    // a pin (e.g. the card's Switch to MindsHub Air, ENG-1304) on the next
    // fetchSessions. Carry the local value through every merge path.
    const model = l.model ?? server.model ?? null;
    // Same story for the in-chat usage alerts (ENG-1782): client-only, the
    // server never has them, and a fetchSessions must not drop the card that
    // explains why a task moved onto the balance while it ran.
    const usageNotices = Array.isArray(l.usageNotices) && l.usageNotices.length ? l.usageNotices : undefined;
    const lMessages = Array.isArray(l.messages) ? l.messages : [];
    const sMessages = Array.isArray(server.messages) ? server.messages : [];
    const isStreaming = lMessages.some((m) => m?.role === '_streaming');
    const hasLocalContent = lMessages.length > 0;
    const countAssistants = (msgs) => (msgs || []).filter((m) => m?.role === 'assistant').length;
    // `server` here always comes from the conversation LIST fetch
    // (fetchSessions), which never carries real messages and so always
    // stamps messagesStatus: 'loading' — spreading it verbatim
    // would reset a task's status back to 'loading' on every background
    // list refresh, even one already confirmed 'loaded' (with zero
    // messages, a genuinely empty conversation) or 'unavailable'. Local
    // knowledge of a task's own fetch state is never staler than a list
    // refresh's placeholder, so it always wins when present.
    const messagesStatus = l.messagesStatus ?? server.messagesStatus;
    // Same story as messagesStatus: `server` is the list fetch, which never
    // carries pagination state at all (undefined, not false) — so the local
    // value always wins when present. Without this, the unconditional
    // background refresh every task-open triggers (openConversation) wipes
    // "load earlier messages" the moment it lands, on a task whose own
    // fetchSession already established there's more history.
    const hasMoreMessages = l.hasMoreMessages ?? server.hasMoreMessages;
    const messagesCursor = l.messagesCursor ?? server.messagesCursor;
    if (!isStreaming && !hasLocalContent) {
      // Even without live messages, prefer the locally-bumped
      // updatedAt if it's newer — handleSendInTask stamps the task
      // before any stream events arrive, so a fetchSessions that
      // races between user-click-send and the first SSE event must
      // not overwrite the bump.
      return {
        ...server, model, usageNotices, messagesStatus, hasMoreMessages, messagesCursor,
        updatedAt: _newerUpdatedAt(l.updatedAt, server.updatedAt),
      };
    }
    if (!isStreaming && countAssistants(sMessages) > countAssistants(lMessages)) {
      return {
        ...server,
        model,
        usageNotices,
        messagesStatus,
        hasMoreMessages,
        messagesCursor,
        updatedAt: _newerUpdatedAt(l.updatedAt, server.updatedAt),
        disabledConnections: l.disabledConnections ?? server.disabledConnections ?? [],
        attachments: lMessages.length && Array.isArray(l.attachments) && l.attachments.length
          ? l.attachments
          : server.attachments,
      };
    }
    return {
      ...server,
      model,
      usageNotices,
      messagesStatus,
      hasMoreMessages,
      messagesCursor,
      // Local wins for the live conversation surface.
      messages: lMessages,
      status: l.status || server.status,
      // Preserve in-flight attachments tracked client-side.
      attachments: lMessages.length && Array.isArray(l.attachments) && l.attachments.length
        ? l.attachments
        : server.attachments,
      // Muted-datasource toggles can change while a turn streams; keep
      // the client list when present.
      disabledConnections: l.disabledConnections ?? server.disabledConnections ?? [],
      updatedAt: _newerUpdatedAt(l.updatedAt, server.updatedAt),
    };
  });
  // Carry over local-only tasks the server hasn't seen yet (e.g. a
  // tmp-id task whose first stream hasn't resolved a real cid).
  const serverIds = new Set(serverTasks.map((t) => t.id));
  for (const t of local) {
    if (!serverIds.has(t.id)) merged.unshift(t);
  }
  return merged;
}
