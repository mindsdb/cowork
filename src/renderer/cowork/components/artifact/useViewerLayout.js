// How much room the artifact viewer gives the artifact (ENG-4387): full
// screen (the modal filling the window) by default, or the modal's own size.
// Remembered on this device, like the layers, so the next artifact opens the
// same way; a doc's preview (DocModal) shares the choice. Viewers stay
// mounted while closed, so every one follows a change made in another.
// Storage can be unavailable (private mode, blocked site data): the choice
// then lives in this page's memory, and the default applies on the next
// launch: full screen. (The toolbar and quick edit bar could be hidden once;
// they always show now, and a saved choice to hide them is ignored.)

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { host } from '../../../platform/host';

// v2: full screen became the default (ENG-4455), so choices saved under the
// old normal-size default start over from it.
export const LAYOUT_STORAGE_KEY = 'cowork.artifactViewer.layout.v2';
export const DEFAULT_LAYOUT = Object.freeze({
  maximized: true,
});
// The viewer keeps the large modal's full height when not full screen, rather
// than shrinking to its content.
const VIEWER_HEIGHT = 'min(820px, 88vh)';
const NAMES = Object.keys(DEFAULT_LAYOUT);

// Choices storage refused to keep, by storage key.
const unsaved = new Map();
const listeners = new Set();

function storageKey(userKey) {
  return userKey ? `${LAYOUT_STORAGE_KEY}:${userKey}` : LAYOUT_STORAGE_KEY;
}

function readRaw(key) {
  if (unsaved.has(key)) return unsaved.get(key);
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key, raw) {
  try {
    window.localStorage.setItem(key, raw);
    unsaved.delete(key);
  } catch {
    unsaved.set(key, raw);
  }
  listeners.forEach((listener) => listener());
}

function parseLayout(raw) {
  try {
    const saved = raw ? JSON.parse(raw) : null;
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_LAYOUT };
    return Object.fromEntries(NAMES.map((name) => [
      name, typeof saved[name] === 'boolean' ? saved[name] : DEFAULT_LAYOUT[name],
    ]));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function readLayout(userKey) {
  return parseLayout(readRaw(storageKey(userKey)));
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * @param {string} [userKey]  Keeps one person's layout apart from another's on a shared device.
 * @returns {{ layout: typeof DEFAULT_LAYOUT, toggle: (name: string) => void }}
 */
export function useViewerLayout(userKey = '') {
  const key = storageKey(userKey);
  // The raw string is the snapshot: a primitive, so React sees no change
  // until the saved choice itself changes.
  const getSnapshot = useCallback(() => readRaw(key), [key]);
  const raw = useSyncExternalStore(subscribe, getSnapshot);
  const layout = useMemo(() => parseLayout(raw), [raw]);
  const toggle = useCallback((name) => {
    if (!NAMES.includes(name)) return;
    const prev = parseLayout(readRaw(key));
    writeRaw(key, JSON.stringify({ ...prev, [name]: !prev[name] }));
  }, [key]);
  return { layout, toggle };
}

/** The full screen shortcut, as `aria-keyshortcuts` names it. */
export function maximizeKeyShortcuts() {
  return host.isMac() ? 'Meta+Shift+Enter' : 'Control+Shift+Enter';
}

/**
 * Cmd/Ctrl+Shift+Enter toggles full screen while `active`. Keys typed inside
 * an artifact's own frame never reach this window, so the page keeps its keys.
 * @param {boolean} active
 * @param {(name: string) => void} toggle  From useViewerLayout.
 */
function useMaximizeShortcut(active, toggle) {
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key !== 'Enter') return;
      event.preventDefault();
      toggle('maximized');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, toggle]);
}

/**
 * The viewer modal's layout: the remembered choice, its toggle and shortcut,
 * and the props that size the <Modal> to match.
 * @param {boolean} open
 */
export function useViewerModal(open) {
  const { layout, toggle } = useViewerLayout();
  useMaximizeShortcut(open, toggle);
  const modalProps = { size: 'lg', height: VIEWER_HEIGHT, fullBleed: layout.maximized };
  return { layout, toggle, modalProps };
}

export default useViewerLayout;
