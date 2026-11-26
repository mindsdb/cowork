import { __resetDraftsForTests, getDraft, setDraft } from '../lib/draftStore';
import { getDraftAttachments, setDraftAttachments } from '../lib/draftAttachments';
import type { InputReference, TaskMode } from './api';


export interface ComposerDraft {
  prompt: string;
  attachments: InputReference[];
  taskMode?: TaskMode;
}

// Selecting another task remounts the composer (it is keyed by task id), so
// an unsent instruction would otherwise vanish while the user compares tasks.
// The full draft lives here for the life of the renderer; the text and
// attachments also go to chat's draft stores so they survive a reload. The mode
// pick doesn't: a stale mode could send a turn the reader didn't mean.
const drafts = new Map<string, ComposerDraft>();

const storeKey = (sessionId: string) => `code:${sessionId}`;


export function readComposerDraft(sessionId: string): ComposerDraft | undefined {
  const draft = drafts.get(sessionId);
  if (draft) return draft;
  const prompt = getDraft(storeKey(sessionId));
  const attachments = getDraftAttachments(storeKey(sessionId)) as InputReference[];
  return prompt || attachments.length ? { prompt, attachments: [...attachments] } : undefined;
}


export function writeComposerDraft(sessionId: string, draft: ComposerDraft): void {
  setDraft(storeKey(sessionId), draft.prompt);
  setDraftAttachments(storeKey(sessionId), draft.attachments);
  if (!draft.prompt && !draft.attachments.length && !draft.taskMode) {
    drafts.delete(sessionId);
    return;
  }
  drafts.set(sessionId, draft);
}


// Test-only: both halves are module-level state.
export function resetComposerDrafts(): void {
  drafts.clear();
  __resetDraftsForTests();
}
