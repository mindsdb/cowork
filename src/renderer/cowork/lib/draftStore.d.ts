export function getDraft(key: string | null | undefined): string;
export function setDraft(key: string | null | undefined, text: string): void;
export function moveDraft(fromKey: string, toKey: string): void;
export function clearDraft(key: string | null | undefined): void;
export function clearDraftsForOrganizationSwitch(): void;
export function __resetDraftsForTests(): void;
