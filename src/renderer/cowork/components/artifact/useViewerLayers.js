// The artifact viewer's layers (ENG-4227). There is one preview; Live edit
// (the code editor, `source` here) and Comments (pins and the inbox) are
// layers on it, switched on and off independently and remembered on this
// device. The quick-edit bar is no layer: it shows whenever it may. Storage
// can be unavailable (private mode, blocked site data), so every read and
// write is guarded and the defaults apply then: both off.

import { useCallback, useState } from 'react';

export const LAYERS_STORAGE_KEY = 'cowork.artifactViewer.layers.v1';
export const DEFAULT_LAYERS = Object.freeze({ source: false, comments: false });
const NAMES = Object.keys(DEFAULT_LAYERS);

function storageKey(userKey) {
  return userKey ? `${LAYERS_STORAGE_KEY}:${userKey}` : LAYERS_STORAGE_KEY;
}

export function readLayers(userKey) {
  try {
    const raw = window.localStorage.getItem(storageKey(userKey));
    const saved = raw ? JSON.parse(raw) : null;
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_LAYERS };
    return Object.fromEntries(NAMES.map((name) => [
      name, typeof saved[name] === 'boolean' ? saved[name] : DEFAULT_LAYERS[name],
    ]));
  } catch {
    return { ...DEFAULT_LAYERS };
  }
}

function writeLayers(userKey, layers) {
  try {
    window.localStorage.setItem(storageKey(userKey), JSON.stringify(layers));
  } catch { /* not remembered this time; the layers still switch */ }
}

/**
 * @param {string} [userKey]  Keeps one person's layers apart from another's on a shared device.
 * @returns {{ layers: typeof DEFAULT_LAYERS, setLayer: (name: string, on: boolean) => void }}
 */
export function useViewerLayers(userKey = '') {
  const [layers, setLayers] = useState(() => readLayers(userKey));
  const setLayer = useCallback((name, on) => {
    if (!NAMES.includes(name)) return;
    setLayers((prev) => {
      if (prev[name] === !!on) return prev;
      const next = { ...prev, [name]: !!on };
      writeLayers(userKey, next);
      return next;
    });
  }, [userKey]);
  return { layers, setLayer };
}

export default useViewerLayers;
