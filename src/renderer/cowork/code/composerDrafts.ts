import type { InputReference } from './api';


export interface ComposerDraft {
  prompt: string;
  attachments: InputReference[];
}

// Selecting another task remounts the composer (it is keyed by task id), so
// an unsent instruction would otherwise vanish while the user compares tasks.
// Drafts are kept per task for the life of the renderer; they are not
// persisted across restarts.
const drafts = new Map<string, ComposerDraft>();


export function readComposerDraft(sessionId: string): ComposerDraft | undefined {
  return drafts.get(sessionId);
}


export function writeComposerDraft(sessionId: string, draft: ComposerDraft): void {
  if (!draft.prompt && !draft.attachments.length) {
    drafts.delete(sessionId);
    return;
  }
  drafts.set(sessionId, draft);
}


export function resetComposerDrafts(): void {
  drafts.clear();
}
