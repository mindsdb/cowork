import { createContext, useContext, useMemo } from 'react';

// The open chat's messages, for a surface inside the chat view that sends a
// turn into it and wants to show the reply where it was asked: the artifact
// viewer's chat bar (ENG-4227). ChatView provides `{ conversationId,
// messages }` from the same task state the transcript renders, so no second
// stream is opened. Default null: no chat to read from.
export const ChatTranscriptContext = createContext(null);

export function useChatTranscript() {
  return useContext(ChatTranscriptContext);
}

/** A task's transcript in the shape ChatTranscriptContext carries. */
export function chatTranscriptOf(task) {
  return { conversationId: task?.id || null, messages: task?.messages || [] };
}

/** chatTranscriptOf, kept the same object while the task's id and messages are. */
export function useTaskTranscript(task) {
  const id = task?.id;
  const messages = task?.messages;
  return useMemo(() => chatTranscriptOf({ id, messages }), [id, messages]);
}

// Outside a chat (the Artifacts page), any chat's transcript by its id, so a
// surface that sent a turn into a chat that is not on screen can follow it
// (ENG-4560). The value is a lookup `(conversationId) => ChatTranscript |
// null`, which follows a chat its first turn renamed. Default null.
export const ConversationTranscriptsContext = createContext(null);

/** The lookup over a task list, for ConversationTranscriptsContext. */
export function transcriptLookup(tasks) {
  return (conversationId) => {
    const id = String(conversationId || '');
    if (!id || !Array.isArray(tasks)) return null;
    const task = tasks.find((t) => String(t?.id || '') === id)
      || tasks.find((t) => String(t?.renamedFrom || '') === id);
    return task ? chatTranscriptOf(task) : null;
  };
}

/** The transcript of chat `conversationId`, when the page provides a lookup. */
export function useConversationTranscript(conversationId) {
  const lookup = useContext(ConversationTranscriptsContext);
  const transcript = conversationId && lookup ? lookup(conversationId) : null;
  const id = transcript?.conversationId || null;
  const messages = transcript?.messages || null;
  return useMemo(() => (id ? { conversationId: id, messages } : null), [id, messages]);
}

/** The lookup itself, for a caller that reads a chat once (not on render). */
export function useConversationTranscripts() {
  return useContext(ConversationTranscriptsContext);
}
