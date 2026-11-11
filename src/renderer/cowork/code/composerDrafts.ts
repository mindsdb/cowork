import { __resetDraftsForTests, getDraft, setDraft } from '../lib/draftStore';
import type { InputReference, TaskMode } from './api';


export interface ComposerDraft {
  prompt: string;
  attachments: InputReference[];
  taskMode?: TaskMode;
}

// Selecting another task remounts the composer (it is keyed by task id), so
// an unsent instruction would otherwise vanish while the user compares tasks.
// The full draft lives here for the life of the renderer; the text also goes
// to chat's draft store so it survives a reload. Attachments and the mode
// pick don't: they are cheap to redo, and a stale mode could send a turn the
// reader didn't mean.
const drafts = new Map<string, ComposerDraft>();

const storeKey = (sessionId: string) => `code:${sessionId}`;


export function readComposerDraft(sessionId: string): ComposerDraft | undefined {
  const draft = drafts.get(sessionId);
  if (draft) return draft;
  const prompt = getDraft(storeKey(sessionId));
  return prompt ? { prompt, attachments: [] } : undefined;
}


export function writeComposerDraft(sessionId: string, draft: ComposerDraft): void {
  setDraft(storeKey(sessionId), draft.prompt);
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
