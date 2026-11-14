// The browser's preferences, as the app holds them now: whether the person
// approves the agent's consequential browser steps (a purchase, a message, a
// submit) on a chat card; clicks by position never ask. The choice is the
// person's server-side setting `browser_approve_steps`
// (settings.browserApproveSteps, beside browserEnabled), so every device and
// tab reads the same one; App.jsx
// feeds it in here whenever settings change. Anything but an explicit `false`
// asks: a server that predates the setting, or settings not read yet, never
// let the app approve a held step for the person (lib/browserApproval.js).
//
// Also whether the browser shows only when the person is needed
// (`browser_only_when_needed`, settings.browserOnlyWhenNeeded): anything but
// an explicit `false` is on (views/ChatView.jsx, lib/browserSteps.js).
//
// And when the person last turned approvals off, by cowork-server's clock
// (`browser_approve_steps_off_at`, settings.browserApproveStepsOffAt, epoch
// ms): the server stamps it on each save that writes approvals off, from
// Settings or a held step's card (its Skip approvals), and the app never
// writes it. The setting is for later steps, so the app approves for the
// person only a step held after that moment (heldAfterApprovalsOff), by the
// time the server stamped on the step's card (`held_at_ms`,
// lib/responseStreamAdapter.js). Every card that was waiting when approvals
// went off, on any tab or device, stays theirs to answer, after a reload too.
// A card with no time, or a server that doesn't say when, approves nothing.

import { useSyncExternalStore } from 'react';

// The device-local copy this replaced: dropped once, never read.
const LEGACY_KEY = 'cowork.browserSteps';
const listeners = new Set();
/** @type {{ askToApprove: boolean, onlyWhenNeeded: boolean, approvalsOffAtMs: number | null }} */
const DEFAULTS = { askToApprove: true, onlyWhenNeeded: true, approvalsOffAtMs: null };
let current = DEFAULTS;
// App.jsx's saveSettings, which writes a setting to the server and to App.
let saver = null;

/** Whether `settings` (App's, camelCase) have the person approve browser steps. */
export function asksToApprove(settings) {
  return settings?.browserApproveSteps !== false;
}

/** Whether `settings` show the browser only when the person is needed. */
export function showsOnlyWhenNeeded(settings) {
  return settings?.browserOnlyWhenNeeded !== false;
}

/**
 * When `settings` say approvals last went off (epoch ms, the server's clock),
 * or null when they don't say. The settings rows carry it as a string.
 *
 * @param {{ browserApproveStepsOffAt?: unknown } | null | undefined} settings
 * @returns {number | null}
 */
export function approvalsOffAtOf(settings) {
  const stored = settings?.browserApproveStepsOffAt;
  if (typeof stored !== 'number' && (typeof stored !== 'string' || !stored.trim())) return null;
  const ms = Number(stored);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Whether a held step's card was held after approvals last went off, both by
 * the server's clock: only such a step is the app's to approve. A card with
 * no time, or no time approvals went off, is not.
 *
 * @param {unknown} heldAtMs the card's `held_at_ms`
 * @param {number | null | undefined} offAtMs
 * @returns {boolean}
 */
export function heldAfterApprovalsOff(heldAtMs, offAtMs) {
  return Number.isFinite(heldAtMs) && Number.isFinite(offAtMs) && heldAtMs > offAtMs;
}

export function getBrowserPrefs() {
  return current;
}

/** Takes the person's settings as they are now (App.jsx, on every change). */
export function syncBrowserPrefs(settings) {
  const next = {
    askToApprove: asksToApprove(settings),
    onlyWhenNeeded: showsOnlyWhenNeeded(settings),
    approvalsOffAtMs: approvalsOffAtOf(settings),
  };
  if (next.askToApprove === current.askToApprove && next.onlyWhenNeeded === current.onlyWhenNeeded
    && next.approvalsOffAtMs === current.approvalsOffAtMs) return;
  current = { ...current, ...next };
  listeners.forEach((fn) => fn(current));
}

export function subscribeBrowserPrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useBrowserPrefs() {
  return useSyncExternalStore(subscribeBrowserPrefs, getBrowserPrefs, getBrowserPrefs);
}

/** App.jsx hands in how settings are saved; returns how to take it back. */
export function setBrowserSettingSaver(save) {
  saver = save;
  return () => { if (saver === save) saver = null; };
}

/**
 * Turns Approve browser steps on or off from a held step's card (its Skip
 * approvals), saved like the switch in Settings. The server stamps when
 * approvals went off, after that card was held, so the card stays the
 * person's to answer. Resolves with whether the setting was saved.
 *
 * @param {boolean} ask
 * @returns {Promise<boolean>}
 */
export async function saveApproveSteps(ask) {
  if (!saver) return false;
  try {
    await saver({ browserApproveSteps: ask });
    return true;
  } catch {
    return false;
  }
}

export function forgetLegacyBrowserPrefs() {
  try { window.localStorage.removeItem(LEGACY_KEY); } catch { /* private window */ }
}

// For tests: back to the defaults.
export function resetBrowserPrefsForTests() {
  current = DEFAULTS;
  saver = null;
}
