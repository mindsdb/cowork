import type { Context } from 'react';

export interface ChatTranscript {
  conversationId: string | null;
  messages: Array<Record<string, unknown>>;
}

export type TranscriptLookup = (conversationId: string | null | undefined) => ChatTranscript | null;

export const ChatTranscriptContext: Context<ChatTranscript | null>;
export function useChatTranscript(): ChatTranscript | null;
export function chatTranscriptOf(task: { id?: string | null; messages?: Array<Record<string, unknown>> } | null | undefined): ChatTranscript;
export function useTaskTranscript(task: { id?: string | null; messages?: Array<Record<string, unknown>> } | null | undefined): ChatTranscript;
export const ConversationTranscriptsContext: Context<TranscriptLookup | null>;
export function transcriptLookup(tasks: Array<{ id?: string | null; renamedFrom?: string | null; messages?: Array<Record<string, unknown>> }> | null | undefined): TranscriptLookup;
export function useConversationTranscript(conversationId: string | null | undefined): ChatTranscript | null;
export function useConversationTranscripts(): TranscriptLookup | null;
