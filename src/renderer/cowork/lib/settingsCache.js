/**
 * Read-through cache of the last successful settings fetch, used only to seed
 * the UI on first paint before the boot fetch resolves.
 *
 * This is a cache of the server — the single source of truth (ENG-941/ENG-1125)
 * — never a competing set of hard-coded defaults. Previously App.jsx seeded its
 * settings state from a literal object whose values could (and did, e.g.
 * showDots) disagree with the server's, so a wrong value flashed until the
 * fetch landed. Now the seed is either the last server response we saw or, on
 * the very first launch, empty — and the boot fetch fills it either way.
 */
const KEY = 'anton.settingsCache';

/** The cached settings blob, or {} when absent/unreadable. */
export function loadCachedSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Persist the latest settings blob for the next cold start. Best-effort. */
export function cacheSettings(settings) {
  try {
    if (!settings || typeof settings !== 'object') return;
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* localStorage unavailable / quota exceeded — first paint just starts bare */
  }
}
