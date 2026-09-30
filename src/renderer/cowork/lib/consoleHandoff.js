// A link from the MindsHub console that opens Cowork web on a fresh composer,
// optionally with one of the existing task-mode samples prefilled:
//
//   /?from=console                                   empty composer
//   /?from=console&mode=games&sample=classic-snake-game
//
// The URL names a sample by id and never carries prompt text. It has to be
// captured before the Keycloak redirect, because web-main.tsx's redirectUri is
// the bare pathname and the query string does not survive login. It is then
// consumed once by HomeView. Nothing here sends a message: the sample is only
// placed in the composer, and the user still presses Send.
import { TASK_MODES } from '../components/taskmodes/taskModes';

const STORAGE_KEY = 'anton.consoleHandoff';
export const CONSOLE_ENTRY_SOURCE = 'console';
// Long enough to cover a real login round trip, short enough that a handoff
// abandoned mid-login does not prefill a composer the user opens much later.
const MAX_AGE_MS = 10 * 60 * 1000;
const HANDOFF_PARAMS = ['from', 'mode', 'sample'];

// Sample ids are derived from their labels so the catalog needs no second key.
// Renaming a label the console links to changes its id; the console's links are
// pinned in consoleHandoff.test.js so that shows up as a failing test.
export const sampleId = (label) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function findSample(modeId, id) {
  const mode = TASK_MODES.find((m) => m.id === modeId);
  const sample = mode?.samples.find((s) => sampleId(s.label) === id);
  return mode && sample ? { mode, sample } : null;
}

const sessionStore = () => {
  try { return window.sessionStorage; } catch { return null; }
};

/** Read the handoff params, stash them, and strip them from the address bar.
    Only a known mode/sample pair is kept; anything else degrades to an empty
    composer rather than being stored. */
export function captureConsoleHandoff(loc = window.location, storage = sessionStore()) {
  let params;
  try { params = new URLSearchParams(loc.search); } catch { return; }
  if (params.get('from') !== CONSOLE_ENTRY_SOURCE) return;

  const match = findSample(params.get('mode'), params.get('sample'));
  const handoff = {
    entrySource: CONSOLE_ENTRY_SOURCE,
    modeId: match ? match.mode.id : null,
    sampleId: match ? sampleId(match.sample.label) : null,
    at: Date.now(),
  };
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(handoff)); } catch {}

  for (const key of HANDOFF_PARAMS) params.delete(key);
  const query = params.toString();
  try {
    window.history.replaceState(window.history.state, '', `${loc.pathname}${query ? `?${query}` : ''}${loc.hash}`);
  } catch {}
}

/** Return the pending handoff and forget it, so it applies exactly once. */
export function takeConsoleHandoff(storage = sessionStore(), now = Date.now()) {
  let raw = null;
  try {
    raw = storage?.getItem(STORAGE_KEY) ?? null;
    storage?.removeItem(STORAGE_KEY);
  } catch { return null; }
  if (!raw) return null;
  let handoff;
  try { handoff = JSON.parse(raw); } catch { return null; }
  if (!handoff || handoff.entrySource !== CONSOLE_ENTRY_SOURCE) return null;
  if (typeof handoff.at !== 'number' || now - handoff.at > MAX_AGE_MS) return null;
  const match = handoff.modeId ? findSample(handoff.modeId, handoff.sampleId) : null;
  return { entrySource: handoff.entrySource, mode: match?.mode ?? null, sample: match?.sample ?? null };
}
