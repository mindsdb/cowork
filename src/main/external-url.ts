/**
 * Normalize a renderer-provided browser URL at Electron's privileged shell
 * boundary. A string prefix check is insufficient here: URL parsing is the
 * canonical authority for schemes and prevents executable/custom handlers from
 * reaching `shell.openExternal` if a renderer call site forgets to validate.
 */
export function normalizeExternalBrowserUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}
