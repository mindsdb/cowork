// The artifact viewer's layers (ENG-4227). There is one preview; Live edit
// (the code editor, `source` here), Comments (pins and the inbox) and Stats
// (viewer analytics, ENG-4455) are layers on it, at most one on at a time
// (switching one on switches the others off). Live edit and Comments are
// remembered on this device; Stats is not, since it loads the artifact's
// analytics and is opened on purpose. The quick-edit bar is no layer: it shows whenever it may. Storage
// can be unavailable (private mode, blocked site data), so every read and
// write is guarded and the defaults apply then: both off.

import { useCallback, useRef, useState } from 'react';

export const LAYERS_STORAGE_KEY = 'cowork.artifactViewer.layers.v1';
export const DEFAULT_LAYERS = Object.freeze({ source: false, comments: false, stats: false });
const NAMES = Object.keys(DEFAULT_LAYERS);
// Layers that are not remembered: they start off on every open.
const UNSAVED = new Set(['stats']);

function storageKey(userKey) {
  return userKey ? `${LAYERS_STORAGE_KEY}:${userKey}` : LAYERS_STORAGE_KEY;
}

export function readLayers(userKey) {
  try {
    const raw = window.localStorage.getItem(storageKey(userKey));
    const saved = raw ? JSON.parse(raw) : null;
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_LAYERS };
    const layers = Object.fromEntries(NAMES.map((name) => [
      name, !UNSAVED.has(name) && typeof saved[name] === 'boolean' ? saved[name] : DEFAULT_LAYERS[name],
    ]));
    // Saved before the two became exclusive: Live edit wins.
    if (layers.source && layers.comments) layers.comments = false;
    return layers;
  } catch {
    return { ...DEFAULT_LAYERS };
  }
}

function writeLayers(userKey, layers) {
  try {
    const saved = Object.fromEntries(Object.entries(layers).filter(([name]) => !UNSAVED.has(name)));
    window.localStorage.setItem(storageKey(userKey), JSON.stringify(saved));
  } catch { /* not remembered this time; the layers still switch */ }
}

/**
 * `setLayer(name, on, { remember: false })` switches a layer for this open
 * only (a host asking the viewer to open on Comments, say): nothing is saved,
 * and `restoreLayers()` puts back the remembered ones once the viewer closes.
 * A later switch the person makes is remembered as usual.
 * @param {string} [userKey]  Keeps one person's layers apart from another's on a shared device.
 * @returns {{
 *   layers: typeof DEFAULT_LAYERS,
 *   setLayer: (name: string, on: boolean, options?: { remember?: boolean }) => void,
 *   restoreLayers: () => void,
 * }}
 */
export function useViewerLayers(userKey = '') {
  const [layers, setLayers] = useState(() => readLayers(userKey));
  // Whether the layers on screen differ from the saved ones for this open only.
  const unsavedRef = useRef(false);
  const setLayer = useCallback((name, on, { remember = true } = {}) => {
    if (!NAMES.includes(name)) return;
    setLayers((prev) => {
      if (prev[name] === !!on) return prev;
      // A switch that changes nothing leaves this open's state as it was.
      unsavedRef.current = !remember;
      const next = on
        ? Object.fromEntries(NAMES.map((other) => [other, other === name]))
        : { ...prev, [name]: false };
      if (remember) writeLayers(userKey, next);
      return next;
    });
  }, [userKey]);
  const restoreLayers = useCallback(() => {
    if (!unsavedRef.current) return;
    unsavedRef.current = false;
    setLayers(readLayers(userKey));
  }, [userKey]);
  return { layers, setLayer, restoreLayers };
}

export default useViewerLayers;
