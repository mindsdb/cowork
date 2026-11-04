// Docs the agent creates or edits in a conversation, as it happens.
//
// The server announces each doc tool write on the conversation's doc stream;
// a newly created doc opens beside the chat at once, so the person watches
// the outline appear and its sections fill instead of waiting for the turn
// to end.
import { useEffect, useRef } from 'react';
import { followConversationDocs } from './docApi';

export function useConversationDocs(conversationId, { onCreated, onUpdated, enabled = true } = {}) {
  const handlers = useRef({ onCreated, onUpdated });
  handlers.current = { onCreated, onUpdated };
  useEffect(() => {
    // A `tmp-` id is the chat's own until the server answers with the real
    // one, which nothing is announced on; this runs again once it changes.
    if (!enabled || !conversationId || String(conversationId).startsWith('tmp-')) return undefined;
    return followConversationDocs(conversationId, {
      onEvent: (ev) => {
        if (ev.type === 'doc.created') handlers.current.onCreated?.(ev);
        else if (ev.type === 'doc.updated') handlers.current.onUpdated?.(ev);
      },
    });
  }, [conversationId, enabled]);
}
