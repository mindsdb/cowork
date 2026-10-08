/**
 * Normalize a URL before handing it to the OS browser or a new browser tab.
 * A string prefix check is insufficient here: URL parsing is the canonical
 * authority for schemes and keeps `javascript:`, `file:` and custom handlers
 * out of `shell.openExternal` (desktop) and `window.open` (web) alike.
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
