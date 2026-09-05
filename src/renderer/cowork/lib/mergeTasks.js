// Keep live conversation content and client-only model pins when reconciling server snapshots.
export function mergeTasksFromServer(serverTasks, localTasks) {
  const local = Array.isArray(localTasks) ? localTasks : [];
  if (!Array.isArray(serverTasks)) return local;
  const localById = new Map(local.map((t) => [t.id, t]));
  // The server timestamp lags until messages persist; keep the newer local timestamp to avoid
  // moving an active task down the list.
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
    const lMessages = Array.isArray(l.messages) ? l.messages : [];
    const sMessages = Array.isArray(server.messages) ? server.messages : [];
    const isStreaming = lMessages.some((m) => m?.role === '_streaming');
    const hasLocalContent = lMessages.length > 0;
    const countAssistants = (msgs) => (msgs || []).filter((m) => m?.role === 'assistant').length;
    if (!isStreaming && !hasLocalContent) {
      // Keep the local timestamp bump even before the first SSE message arrives.
      return { ...server, model, updatedAt: _newerUpdatedAt(l.updatedAt, server.updatedAt) };
    }
    if (!isStreaming && countAssistants(sMessages) > countAssistants(lMessages)) {
      return {
        ...server,
        model,
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
