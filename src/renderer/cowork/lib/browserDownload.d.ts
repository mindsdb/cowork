export const MOBILE_DOWNLOAD_NOTE: string;
export function downloadUnavailableMessage(fallback: string): string;
export function downloadFilename(path: string | null | undefined, fallback?: string): string;
export function downloadUrl(url: string, filename?: string): boolean;
export function downloadBlob(blob: Blob, filename?: string): boolean;
