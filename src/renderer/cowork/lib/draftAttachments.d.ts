export interface DraftFileBackend {
  get(key: string): Promise<unknown>;
  put(key: string, blob: Blob): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  keys(): Promise<unknown[]>;
}

export function getDraftAttachments(key: string | null | undefined): readonly unknown[];
export function setDraftAttachments(key: string | null | undefined, list: readonly unknown[]): void;
export function clearDraftAttachments(key: string | null | undefined): void;
export function moveDraftAttachments(fromKey: string, toKey: string): void;
export function clearAllDraftAttachments(): void;
export function reloadDraftAttachmentsAfterPurge(): void;
export function subscribeDraftAttachments(listener: () => void): () => void;
export function __resetDraftAttachmentsForTests(backend?: DraftFileBackend): void;
export function __flushDraftAttachmentsForTests(): Promise<void>;
