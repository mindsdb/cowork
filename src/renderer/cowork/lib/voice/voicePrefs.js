// The voice call's preferences on this device (ENG-4138, prototype): whether
// the voice agent is on, and the voice it speaks in. Saved in localStorage and
// applied at once, not with the settings form: a voice change is heard right
// away (App previews it, or moves a live call to it).

import { useSyncExternalStore } from 'react';

const KEY = 'cowork.voiceCall';

// GPT-Live's voices (the server keeps the same list, cowork.services.voice).
export const VOICES = [
  { value: 'marin', label: 'Marin', accent: 'North American · default' },
  { value: 'cedar', label: 'Cedar', accent: 'North American' },
  { value: 'gleam', label: 'Gleam', accent: 'North American' },
  { value: 'meridian', label: 'Meridian', accent: 'North American' },
  { value: 'vesper', label: 'Vesper', accent: 'British' },
  { value: 'willow', label: 'Willow', accent: 'Irish' },
  { value: 'stone', label: 'Stone', accent: 'Irish' },
  { value: 'quartz', label: 'Quartz', accent: 'Australian' },
  { value: 'ripple', label: 'Ripple', accent: 'Australian' },
  { value: 'delta', label: 'Delta', accent: 'Southern U.S.' },
  { value: 'cinder', label: 'Cinder', accent: 'Southern U.S.' },
  { value: 'beacon', label: 'Beacon', accent: 'Filipino' },
  { value: 'bossa', label: 'Bossa', accent: 'Portuguese' },
  { value: 'tempo', label: 'Tempo', accent: 'Portuguese' },
  { value: 'brise', label: 'Brise', accent: 'French' },
  { value: 'sillage', label: 'Sillage', accent: 'French' },
  { value: 'nuri', label: 'Nuri', accent: 'German' },
  { value: 'juni', label: 'Juni', accent: 'German' },
  { value: 'flitz', label: 'Flitz', accent: 'German' },
  { value: 'nira', label: 'Nira', accent: 'Hindi' },
  { value: 'harema', label: 'Harema', accent: 'Japanese' },
  { value: 'shida', label: 'Shida', accent: 'Japanese' },
  { value: 'noeul', label: 'Noeul', accent: 'Korean' },
];
export const DEFAULT_VOICE = 'marin';

const DEFAULTS = { enabled: true, voice: DEFAULT_VOICE };
const listeners = new Set();
let current = null;

function read() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || '{}');
    return {
      enabled: saved.enabled !== false,
      voice: VOICES.some((v) => v.value === saved.voice) ? saved.voice : DEFAULT_VOICE,
    };
  } catch {
    return DEFAULTS;
  }
}

export function getVoicePrefs() {
  if (!current) current = read();
  return current;
}

/**
 * Saves a change. `change.voice` reaches every listener with `{ voiceChanged:
 * true }`, so App can say something in the new voice.
 */
export function setVoicePrefs(change) {
  const before = getVoicePrefs();
  current = { ...before, ...change };
  try { window.localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private window */ }
  const voiceChanged = Boolean(change.voice) && change.voice !== before.voice;
  listeners.forEach((fn) => fn(current, { voiceChanged }));
}

export function subscribeVoicePrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useVoicePrefs() {
  return useSyncExternalStore(subscribeVoicePrefs, getVoicePrefs, getVoicePrefs);
}

export function voiceLabel(value) {
  return VOICES.find((v) => v.value === value)?.label || 'Marin';
}

// For tests: forget the cached read.
export function resetVoicePrefsForTests() {
  current = null;
}
