import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { fetchHubDirectory, fetchHubPeopleByIds, fetchHubTeams, fetchSkillSharingCapabilities } from '../api';
import { subscribeOrganizationChanges } from '../lib/organizationChanges';
import { SHARING_OFF } from '../lib/orgSharing';

/*
 * What org sharing (ENG-3787) allows here, and the caller's teams. Both are
 * read once per organization and shared by every surface that asks: the
 * Skills page, the skill Share dialog and the artifact Share panel.
 *
 * Until the answer lands, and on any failure, the capabilities read as off,
 * so those surfaces render exactly as they do on a build without it. Their
 * `status` says whether the answer is in (ready), still coming (loading) or
 * failed (error), for a surface that must not act before it knows.
 */

let capabilitiesPromise = null;
let teamsPromise = null;

subscribeOrganizationChanges(() => {
  capabilitiesPromise = null;
  teamsPromise = null;
  resetDirectory();
});

function loadCapabilities() {
  if (!capabilitiesPromise) {
    capabilitiesPromise = Promise.resolve().then(() => fetchSkillSharingCapabilities()).catch((error) => {
      // A failed read is asked again on the next mount or retry, never
      // cached, and never taken for "sharing is off".
      capabilitiesPromise = null;
      throw error;
    });
  }
  return capabilitiesPromise;
}

function loadTeams() {
  if (!teamsPromise) {
    teamsPromise = Promise.resolve().then(() => fetchHubTeams()).then((result) => {
      // An unreachable hub is asked again next time.
      if (!result.reachable) teamsPromise = null;
      return result;
    }).catch(() => {
      teamsPromise = null;
      return { reachable: false, teams: [] };
    });
  }
  return teamsPromise;
}

/** For tests: forget what was read. */
export function __resetOrgSharingForTests() {
  capabilitiesPromise = null;
  teamsPromise = null;
  resetDirectory();
}

/**
 * What org sharing allows: `{ status, capabilities, retry }`.
 * `capabilities` is `{ enabled, can_share_org, can_write_org, org_name }`,
 * off (`SHARING_OFF`) until the answer lands and when it couldn't be read.
 * `status` is 'idle' while `active` is false (nothing is asked), then
 * 'loading', 'ready', or 'error', which `retry` asks again.
 */
export function useSharingCapabilities(active = true) {
  const [state, setState] = useState({ status: 'loading', capabilities: SHARING_OFF });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    setState((current) => (current.status === 'ready' ? current : { status: 'loading', capabilities: SHARING_OFF }));
    loadCapabilities().then(
      (capabilities) => { if (live) setState({ status: 'ready', capabilities }); },
      () => { if (live) setState({ status: 'error', capabilities: SHARING_OFF }); },
    );
    return () => { live = false; };
  }, [active, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return active ? { ...state, retry } : { status: 'idle', capabilities: SHARING_OFF, retry };
}

/**
 * The caller's teams, read only while `active`.
 * `status` is 'idle' | 'loading' | 'ready'; `reachable` false means the hub
 * could not be asked.
 */
export function useHubTeams(active) {
  const [state, setState] = useState({ status: 'idle', reachable: true, teams: [] });
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    setState((current) => (current.status === 'ready' ? current : { ...current, status: 'loading' }));
    loadTeams().then((result) => {
      if (live) setState({ status: 'ready', reachable: result.reachable, teams: result.teams });
    });
    return () => { live = false; };
  }, [active]);
  return state;
}

/* How long after a failed lookup the ids it couldn't ask are asked again,
   on whichever render comes next. */
const PEOPLE_RETRY_AFTER_MS = 5000;

/**
 * The people an audience names by user id (`allowed_user_ids`), as the
 * `<RecipientField>` shows them: `{ id, name, email }` once the hub has named
 * them, `{ id, pending: true }` while it's being asked, `{ id, failed: true }`
 * when the hub couldn't be asked about them, and `{ id, name: null, email:
 * null }` for an id the hub answered it doesn't know (an "Unknown person").
 *
 * Ids are asked once each (`fetchHubPeopleByIds`). Ids a lookup couldn't ask
 * are never taken for unknown: they are asked again on the next render a few
 * seconds on, on the next open (a new mount), or on `retry`. `remember`
 * records people the picker found, so a pick is never looked up again.
 * `unreachable` is true while any of `ids` couldn't be looked up.
 */
export function useKnownPeople(ids) {
  const [known, setKnown] = useState(() => new Map());
  const [unknown, setUnknown] = useState(() => new Set());
  const [failed, setFailed] = useState(() => new Set());
  const [, setAttempt] = useState(0);
  const asked = useRef(new Set());
  const failedAt = useRef(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const list = ids || [];
  // Every render: new ids are asked at once, ids that couldn't be asked once
  // the retry delay has passed.
  useEffect(() => {
    const retrying = Date.now() - failedAt.current >= PEOPLE_RETRY_AFTER_MS;
    const toAsk = list.filter((id) => !known.has(id) && !unknown.has(id) && !asked.current.has(id)
      && (retrying || !failed.has(id)));
    if (toAsk.length === 0) return;
    for (const id of toAsk) asked.current.add(id);
    if (toAsk.some((id) => failed.has(id))) {
      setFailed((current) => new Set([...current].filter((id) => !toAsk.includes(id))));
    }
    // Not cancelled when the ids change: an answer for an id that has since
    // been removed is harmless, and dropping it would leave the rest pending.
    Promise.resolve().then(() => fetchHubPeopleByIds(toAsk)).catch(() => null).then((result) => {
      if (!live.current) return;
      const found = new Map((result?.people || []).map((person) => [person.id, person]));
      // Only an id the hub answered for can be unknown; the rest of a failed
      // lookup are asked again later.
      const unanswered = new Set(result
        ? (Array.isArray(result.unanswered) ? result.unanswered : (result.reachable ? [] : toAsk))
        : toAsk);
      const notAsked = toAsk.filter((id) => !found.has(id) && unanswered.has(id));
      const missing = toAsk.filter((id) => !found.has(id) && !unanswered.has(id));
      if (found.size) {
        setKnown((current) => {
          const next = new Map(current);
          for (const [id, person] of found) next.set(id, person);
          return next;
        });
      }
      if (missing.length) setUnknown((current) => new Set([...current, ...missing]));
      if (notAsked.length) {
        for (const id of notAsked) asked.current.delete(id);
        failedAt.current = Date.now();
        setFailed((current) => new Set([...current, ...notAsked]));
      }
    });
  });

  const remember = useCallback((people) => {
    setKnown((current) => {
      const next = new Map(current);
      for (const person of people || []) if (person?.id && person.email) next.set(person.id, person);
      return next;
    });
  }, []);

  /** Asks again, now, for the ids that couldn't be looked up. */
  const retry = useCallback(() => {
    failedAt.current = 0;
    setAttempt((n) => n + 1);
  }, []);

  const people = list.map((id) => {
    if (known.has(id)) return known.get(id);
    if (unknown.has(id)) return { id, name: null, email: null };
    if (failed.has(id)) return { id, name: null, email: null, failed: true };
    return { id, name: null, email: null, pending: true };
  });
  return { people, remember, retry, unreachable: people.some((person) => person.failed === true) };
}

/*
 * The org's people directory (`fetchHubDirectory`), read once per session and
 * organization and shared by every recipient picker, so filtering is local.
 * A failure is not cached: it shows as `error` until `retry` asks again.
 * `refresh` reads it again while the loaded list stays in place
 * (`refreshing`), for an address the list is too old to know. This is the
 * app's one copy of the directory, and `loadedAt` says how old it is.
 */
const DIRECTORY_IDLE = Object.freeze({ status: 'idle', people: [], truncated: false, loadedAt: 0, refreshing: false });

/** How old the directory may be before an address it doesn't have is
    checked against a fresh copy. */
export const DIRECTORY_MAX_AGE_MS = 60 * 1000;
let directory = DIRECTORY_IDLE;
let directoryGeneration = 0;
const directoryListeners = new Set();

function setDirectory(next) {
  directory = next;
  for (const listener of directoryListeners) listener();
}

function resetDirectory() {
  directoryGeneration += 1;
  setDirectory(DIRECTORY_IDLE);
}

function readDirectoryInto(generation, onFailure) {
  Promise.resolve().then(() => fetchHubDirectory()).catch(() => null).then((result) => {
    if (generation !== directoryGeneration) return;
    if (!result || !result.reachable) {
      onFailure();
      return;
    }
    setDirectory({
      status: 'ready',
      people: result.people || [],
      truncated: result.truncated === true,
      loadedAt: Date.now(),
      refreshing: false,
    });
  });
}

function loadDirectory() {
  if (directory.status === 'loading' || directory.status === 'ready') return;
  const generation = directoryGeneration;
  setDirectory({ ...DIRECTORY_IDLE, status: 'loading' });
  readDirectoryInto(generation, () => setDirectory({ ...DIRECTORY_IDLE, status: 'error' }));
}

/* Reads a loaded directory again. A failure keeps the list it had. */
function refreshDirectory() {
  if (directory.status !== 'ready' || directory.refreshing) return;
  const generation = directoryGeneration;
  setDirectory({ ...directory, refreshing: true });
  readDirectoryInto(generation, () => setDirectory({ ...directory, refreshing: false }));
}

function subscribeDirectory(listener) {
  directoryListeners.add(listener);
  return () => directoryListeners.delete(listener);
}

const readDirectory = () => directory;

/**
 * Everyone in the org, for the recipient picker: `{ status, people,
 * truncated, loadedAt, refreshing, retry, refresh }`, `status` being
 * 'idle' | 'loading' | 'ready' | 'error'. Read the first time a picker is
 * `active`; every later picker shares it.
 */
export function useOrgDirectory(active = true) {
  const state = useSyncExternalStore(subscribeDirectory, readDirectory, readDirectory);
  useEffect(() => {
    if (active && directory.status === 'idle') loadDirectory();
  }, [active]);
  const retry = useCallback(() => {
    if (directory.status === 'error') {
      setDirectory(DIRECTORY_IDLE);
      loadDirectory();
    }
  }, []);
  return { ...state, retry, refresh: refreshDirectory };
}
