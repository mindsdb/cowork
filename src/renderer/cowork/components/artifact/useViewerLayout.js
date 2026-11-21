// How much room the artifact viewer gives the artifact (ENG-4387): full
// screen (the modal filling the window) by default, or the modal's own size. Remembered on this device, like the layers, so the
// next artifact opens the same way. Storage can be unavailable (private mode,
// blocked site data), so every read and write is guarded and the default
// applies then: full screen. (The toolbar and quick edit bar could be
// hidden once; they always show now, and a saved choice to hide them is
// ignored.)

import { useCallback, useState } from 'react';

// v2: full screen became the default (ENG-4455), so choices saved under the
// old normal-size default start over from it.
export const LAYOUT_STORAGE_KEY = 'cowork.artifactViewer.layout.v2';
export const DEFAULT_LAYOUT = Object.freeze({
  maximized: true,
});
const NAMES = Object.keys(DEFAULT_LAYOUT);

function storageKey(userKey) {
  return userKey ? `${LAYOUT_STORAGE_KEY}:${userKey}` : LAYOUT_STORAGE_KEY;
}

export function readLayout(userKey) {
  try {
    const raw = window.localStorage.getItem(storageKey(userKey));
    const saved = raw ? JSON.parse(raw) : null;
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_LAYOUT };
    return Object.fromEntries(NAMES.map((name) => [
      name, typeof saved[name] === 'boolean' ? saved[name] : DEFAULT_LAYOUT[name],
    ]));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function writeLayout(userKey, layout) {
  try {
    window.localStorage.setItem(storageKey(userKey), JSON.stringify(layout));
  } catch { /* not remembered this time; the layout still changes */ }
}

/**
 * @param {string} [userKey]  Keeps one person's layout apart from another's on a shared device.
 * @returns {{ layout: typeof DEFAULT_LAYOUT, toggle: (name: string) => void }}
 */
export function useViewerLayout(userKey = '') {
  const [layout, setLayout] = useState(() => readLayout(userKey));
  const toggle = useCallback((name) => {
    if (!NAMES.includes(name)) return;
    setLayout((prev) => {
      const next = { ...prev, [name]: !prev[name] };
      writeLayout(userKey, next);
      return next;
    });
  }, [userKey]);
  return { layout, toggle };
}

export default useViewerLayout;
