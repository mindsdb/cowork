import { createContext, useContext } from 'react';

// The open chat's messages, for a surface inside the chat view that sends a
// turn into it and wants to show the reply where it was asked: the artifact
// viewer's chat bar (ENG-4227). ChatView provides `{ conversationId,
// messages }` from the same task state the transcript renders, so no second
// stream is opened. Default null: no chat to read from.
export const ChatTranscriptContext = createContext(null);

export function useChatTranscript() {
  return useContext(ChatTranscriptContext);
}
