// The browser's preferences on this device: whether the person approves the
// agent's consequential browser steps (a purchase, a message, a submit) on a
// chat card. Off by default: the app approves them for the person and never
// shows the card (lib/browserApproval.js, App.jsx). Saved in localStorage.

import { useSyncExternalStore } from 'react';

const KEY = 'cowork.browserSteps';
const listeners = new Set();
let current = null;

function read() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || '{}');
    return { askToApprove: saved.askToApprove === true };
  } catch {
    return { askToApprove: false };
  }
}

export function getBrowserPrefs() {
  if (!current) current = read();
  return current;
}

export function setBrowserPrefs(change) {
  current = { ...getBrowserPrefs(), ...change };
  try { window.localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private window */ }
  listeners.forEach((fn) => fn(current));
}

export function subscribeBrowserPrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useBrowserPrefs() {
  return useSyncExternalStore(subscribeBrowserPrefs, getBrowserPrefs, getBrowserPrefs);
}

// For tests: forget the cached read.
export function resetBrowserPrefsForTests() {
  current = null;
}
