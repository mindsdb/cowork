import type { Context } from 'react';

export interface ChatTranscript {
  conversationId: string | null;
  messages: Array<Record<string, unknown>>;
}

export const ChatTranscriptContext: Context<ChatTranscript | null>;
export function useChatTranscript(): ChatTranscript | null;
