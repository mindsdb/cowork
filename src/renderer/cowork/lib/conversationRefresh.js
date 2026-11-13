// "This conversation changed on the server; fetch it again." For a change made
// outside any stream this client reads: a quick edit from the artifact
// viewer's chat bar (ENG-4227) saves or updates its group message in the
// artifact's chat. App listens and catches the chat up with the same refetch a
// run that finished elsewhere gets.

const listeners = new Set();

export function requestConversationRefresh(conversationId) {
  if (!conversationId) return;
  for (const listener of listeners) {
    try { listener(String(conversationId)); } catch { /* one listener's failure is its own */ }
  }
}

export function onConversationRefresh(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
