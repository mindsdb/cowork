// A link from the MindsHub console that opens Cowork web on a fresh composer,
// optionally with one of the existing task-mode samples prefilled:
//
//   /?from=console                                   empty composer
//   /?from=console&mode=games&sample=classic-snake-game
//   /?from=console&start=own-work                    the own-work mode (the first onboarding step)
//   /?from=console&mode=games&sample=…&placement=gallery
//                                                    …and where in the console it came from
//   /?from=console&placement=sign-in                 the console's landing after a fresh sign-in
//
// The URL names a sample, or a start the app owns, by id and never carries
// prompt text. It has to be captured before the Keycloak redirect, because
// web-main.tsx's redirectUri is the bare pathname and the query string does
// not survive login. It is then consumed once by HomeView. Nothing here sends
// a message: a sample is only placed in the composer, the own-work start only
// opens the own-work mode, and the user still presses Send.
import { TASK_MODES, OWN_WORK_MODE } from '../components/taskmodes/taskModes';

const STORAGE_KEY = 'anton.consoleHandoff';
export const CONSOLE_ENTRY_SOURCE = 'console';
// Long enough to cover a real login round trip, short enough that a handoff
// abandoned mid-login does not prefill a composer the user opens much later.
const MAX_AGE_MS = 10 * 60 * 1000;
const HANDOFF_PARAMS = ['from', 'mode', 'sample', 'start', 'placement'];

// Starts a link may ask for. Anything else is dropped, so a bad link opens an
// empty composer.
export const OWN_WORK_START = 'own-work';
const STARTS = [OWN_WORK_START];

// Where in the console the link was clicked, so a task can be credited to the
// surface that led to it. `sign-in` is not a click: the console sends a fresh
// web sign-in here on its own. Only these are kept; anything else reads as
// unknown.
export const SIGN_IN_PLACEMENT = 'sign-in';
export const PLACEMENTS = ['gallery', SIGN_IN_PLACEMENT];

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

// Text earlier builds placed in the composer and no longer offer. Drafts are
// kept in localStorage with no expiry, so a placed but unsent one can outlive
// the build that placed it. This is the own-work prompt a console link placed
// until the own-work mode replaced it; it asks Cowork to open with a question.
export const RETIRED_PROMPTS = [
  'I\'d like to start with something real from my work. Ask me one question about what I\'m working on, and give me two or three small examples to jump-start it, like a report to update, a spreadsheet to clean, or a thread to answer. Tell me I can attach a file, paste notes or a link, or connect Gmail, and say you\'ll take the first step once I answer.',
];

/** Whether *text* is a sample prompt exactly as placed, never edited. Such a
    draft is text a sample put in the composer, not the user's own, so a later
    handoff may replace it. */
export const isUntouchedSample = (text) => {
  const trimmed = (text || '').trim();
  return (
    Boolean(trimmed) &&
    (RETIRED_PROMPTS.includes(trimmed) ||
      [...TASK_MODES, OWN_WORK_MODE].some((m) => m.samples.some((s) => s.prompt === trimmed)))
  );
};

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
  const start = STARTS.includes(params.get('start')) ? params.get('start') : null;
  const placement = PLACEMENTS.includes(params.get('placement')) ? params.get('placement') : null;
  const handoff = {
    entrySource: CONSOLE_ENTRY_SOURCE,
    modeId: match ? match.mode.id : null,
    sampleId: match ? sampleId(match.sample.label) : null,
    start,
    placement,
    at: Date.now(),
  };
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(handoff)); } catch {}

  for (const key of HANDOFF_PARAMS) params.delete(key);
  const query = params.toString();
  try {
    window.history.replaceState(window.history.state, '', `${loc.pathname}${query ? `?${query}` : ''}${loc.hash || ''}`);
  } catch {}
}

function readHandoff(storage, now) {
  let raw = null;
  try { raw = storage?.getItem(STORAGE_KEY) ?? null; } catch { return null; }
  if (!raw) return null;
  let handoff;
  try { handoff = JSON.parse(raw); } catch { return null; }
  if (!handoff || handoff.entrySource !== CONSOLE_ENTRY_SOURCE) return null;
  if (typeof handoff.at !== 'number' || now - handoff.at > MAX_AGE_MS) return null;
  const match = handoff.modeId ? findSample(handoff.modeId, handoff.sampleId) : null;
  // A sample wins over a start: the link asked for a specific example.
  const start = !match && STARTS.includes(handoff.start) ? handoff.start : null;
  const placement = PLACEMENTS.includes(handoff.placement) ? handoff.placement : null;
  return {
    entrySource: handoff.entrySource,
    mode: match?.mode ?? null,
    sample: match?.sample ?? null,
    start,
    placement,
    recorded: handoff.recorded === true,
  };
}

/** The pending handoff, left in place. Home reads it to record an arrival it
    cannot apply yet, because the composer is not usable. */
export function peekConsoleHandoff(storage = sessionStore(), now = Date.now()) {
  return readHandoff(storage, now);
}

/** Note that the pending handoff's arrival has been recorded, so taking it
    later does not record it a second time. */
export function markConsoleHandoffRecorded(storage = sessionStore()) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return;
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...JSON.parse(raw), recorded: true }));
  } catch {}
}

/** Return the pending handoff and forget it, so it applies exactly once. */
export function takeConsoleHandoff(storage = sessionStore(), now = Date.now()) {
  const handoff = readHandoff(storage, now);
  try { storage?.removeItem(STORAGE_KEY); } catch { return null; }
  return handoff;
}
