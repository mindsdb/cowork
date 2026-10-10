export function copyText(value: unknown): Promise<boolean>;
export function trimCopiedSelection(event: { preventDefault(): void; clipboardData: DataTransfer | null }): void;
