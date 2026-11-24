// When the Use Case Gallery column is offered and when it opens by itself.

const STORAGE_KEY = 'anton.gallery.settled';

/**
 * Where the column exists at all: Desktop and hosted Cowork Web. Not the
 * mobile app (no room beside Home), and not a self-hosted web build, which has
 * no MindsHub console to read the examples from.
 */
export function galleryOffered({ isWeb, platformUi, isMobileShell }) {
  if (isMobileShell) return false;
  if (isWeb && !platformUi) return false;
  return true;
}

/**
 * Whether it opens by itself on Home: only for an account with no tasks yet,
 * once the task list has actually loaded (a list still loading, or one that
 * failed, is not an empty account), and only until it has been folded or used
 * in this browser or on this Desktop install.
 */
export function opensByItself({ offered, hasManifest, tasksStatus, taskCount, settled }) {
  return Boolean(offered && hasManifest && tasksStatus === 'ready' && taskCount === 0 && !settled);
}

const PRODUCTION_API = 'https://api.mindshub.ai';

/**
 * Whether to replay the first run for testing: `?gallery=first-run` on the
 * address, honoured only away from production (PR environments, dev,
 * staging), so the first run can be seen again with any account. Production
 * ignores it, so it never needs removing and real users cannot trigger it.
 */
export function firstRunPreviewRequested({ search, apiBase }) {
  if (String(apiBase || '').replace(/\/+$/, '') === PRODUCTION_API) return false;
  try {
    return new URLSearchParams(search || '').get('gallery') === 'first-run';
  } catch {
    return false;
  }
}

/* Per browser, or per Desktop install: localStorage, like the checklist. A
   storage that throws (private mode, blocked site data) reads as not settled,
   so at worst the column opens once more; it never fails to render. */
export function readGallerySettled(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markGallerySettled(storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, '1');
  } catch {
    // Not remembered; see readGallerySettled.
  }
}

/** "About 3 minutes" style run time, or null when unknown. */
export function runMinutes(seconds) {
  if (seconds == null) return null;
  return Math.max(1, Math.round(seconds / 60));
}
