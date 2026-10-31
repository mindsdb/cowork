import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  fetchMindsHubDirectory, fetchMindsHubPeopleByEmails, fetchMindsHubPeopleByIds, fetchMindsHubTeams,
  fetchSkillSharingCapabilities,
} from '../api';
import { subscribeOrganizationChanges } from '../lib/organizationChanges';
import { SHARING_OFF, permissionsUnknown, sharingOrgName, teamsUnknown } from '../lib/orgSharing';
import { LOAD_STATUS, MINDSHUB_ERROR_CODE, firstMindsHubFailure } from '../lib/sharingContract';
import { useAccountUser } from './useAccountUser';
import { useMindsOrgs } from './useMindsOrgs';

/*
 * What sharing inside the org allows here, and the caller's teams. Both are
 * read once per organization and shared by every surface that asks: the
 * Skills page, the skill Share dialog and the artifact Share panel.
 *
 * Until the answer lands, and on any failure, the capabilities read as off,
 * so those surfaces render exactly as they do on a build without it. Their
 * `status` (LOAD_STATUS) says whether the answer is in (ready), still coming
 * (loading) or failed (error), for a surface that must not act before it
 * knows.
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
    capabilitiesPromise = Promise.resolve().then(() => fetchSkillSharingCapabilities()).then((capabilities) => {
      // An answer MindsHub couldn't fully give (its permissions or teams
      // unknown) is asked again on the next mount or retry.
      if (permissionsUnknown(capabilities) || teamsUnknown(capabilities)) capabilitiesPromise = null;
      return capabilities;
    }, (error) => {
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
    teamsPromise = Promise.resolve().then(() => fetchMindsHubTeams()).then((result) => {
      // No answer from MindsHub: asked again next time.
      if (!result.reachable) teamsPromise = null;
      return result;
    }).catch(() => {
      teamsPromise = null;
      return { reachable: false, failure: MINDSHUB_ERROR_CODE.UNREACHABLE, teams: [] };
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
 * What sharing allows: `{ status, capabilities, retry }`.
 * `capabilities` is lib/sharingContract's SharingCapabilities, off
 * (`SHARING_OFF`) until the answer lands and when it couldn't be read.
 * `status` is idle while `active` is false (nothing is asked), then
 * loading, ready, or error, which `retry` asks again. `retry` also asks
 * again for an answer whose permissions or teams MindsHub couldn't give.
 */
export function useSharingCapabilities(active = true) {
  const [state, setState] = useState({ status: LOAD_STATUS.LOADING, capabilities: SHARING_OFF });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    setState((current) => (current.status === LOAD_STATUS.READY
      ? current
      : { status: LOAD_STATUS.LOADING, capabilities: SHARING_OFF }));
    loadCapabilities().then(
      (capabilities) => { if (live) setState({ status: LOAD_STATUS.READY, capabilities }); },
      () => { if (live) setState({ status: LOAD_STATUS.ERROR, capabilities: SHARING_OFF }); },
    );
    return () => { live = false; };
  }, [active, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return active ? { ...state, retry } : { status: LOAD_STATUS.IDLE, capabilities: SHARING_OFF, retry };
}

/**
 * The caller's teams, read only while `active`.
 * `status` is idle, loading or ready; `reachable` false means MindsHub gave
 * no answer, and `failure` (a MINDSHUB_ERROR_CODE) says why.
 */
export function useMindsHubTeams(active) {
  const [state, setState] = useState({ status: LOAD_STATUS.IDLE, reachable: true, failure: null, teams: [] });
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    setState((current) => (current.status === LOAD_STATUS.READY ? current : { ...current, status: LOAD_STATUS.LOADING }));
    loadTeams().then((result) => {
      if (!live) return;
      setState({
        status: LOAD_STATUS.READY,
        reachable: result.reachable,
        failure: result.reachable ? null : (result.failure || MINDSHUB_ERROR_CODE.UNREACHABLE),
        teams: result.teams,
      });
    });
    return () => { live = false; };
  }, [active]);
  return state;
}

/**
 * The active organization's name for sharing copy (lib/orgSharing's
 * sharingOrgName), from the app's own organization list (useMindsOrgs,
 * MindsHub UI only), read only while `active`. Null until it lands, and when
 * no name is known.
 */
export function useSharingOrgName(active) {
  const accountUser = useAccountUser(false, { active });
  const { activeOrg } = useMindsOrgs(accountUser);
  return active ? sharingOrgName(activeOrg) : null;
}

/* How long after a failed lookup the ids it couldn't ask are asked again,
   on whichever render comes next, when MindsHub couldn't be asked. */
const PEOPLE_RETRY_AFTER_MS = 5000;

/**
 * The people an audience names by user id, as the `<RecipientField>` shows
 * them: `{ id, name, email }` once MindsHub has named them, `{ id, pending:
 * true }` while it's being asked, `{ id, failed: true }` when MindsHub gave
 * no answer about them, and `{ id, name: null, email: null }` for an id
 * MindsHub answered it doesn't know (an "Unknown person"), or one
 * cowork-server refused as no UUID, which names nobody.
 *
 * Ids are asked once each (`fetchMindsHubPeopleByIds`). Ids a lookup got no
 * answer for are never taken for unknown. When MindsHub couldn't be asked
 * they are asked again on the next render a few seconds on; after a throttle
 * or a refusal only on `retry`. Any of them is asked again on the next open
 * (a new mount). `remember` records people the picker found, so a pick is
 * never looked up again. `failure` (a MINDSHUB_ERROR_CODE) says why any of
 * `ids` got no answer, null while none did (firstMindsHubFailure picks one).
 */
export function useKnownPeople(ids) {
  const [known, setKnown] = useState(() => new Map());
  const [unknown, setUnknown] = useState(() => new Set());
  // The ids MindsHub gave no answer for, each with why.
  const [failed, setFailed] = useState(() => new Map());
  const [, setAttempt] = useState(0);
  const asked = useRef(new Set());
  const failedAt = useRef(0);
  const retryAll = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const list = ids || [];
  // Every render: new ids are asked at once; ids MindsHub couldn't be asked
  // about once the retry delay has passed, and every failed id on `retry`.
  useEffect(() => {
    const retrying = Date.now() - failedAt.current >= PEOPLE_RETRY_AFTER_MS;
    const retryingAll = retryAll.current;
    retryAll.current = false;
    const askAgain = (id) => retryingAll
      || (retrying && failed.get(id) === MINDSHUB_ERROR_CODE.UNREACHABLE);
    const toAsk = list.filter((id) => !known.has(id) && !unknown.has(id) && !asked.current.has(id)
      && (!failed.has(id) || askAgain(id)));
    if (toAsk.length === 0) return;
    for (const id of toAsk) asked.current.add(id);
    if (toAsk.some((id) => failed.has(id))) {
      setFailed((current) => new Map([...current].filter(([id]) => !toAsk.includes(id))));
    }
    // Not canceled when the ids change: an answer for an id that has since
    // been removed is harmless, and dropping it would leave the rest pending.
    Promise.resolve().then(() => fetchMindsHubPeopleByIds(toAsk)).catch(() => null).then((result) => {
      if (!live.current) return;
      const found = new Map((result?.people || []).map((person) => [person.id, person]));
      // Only an id MindsHub answered for, or one refused as no UUID
      // (`invalid`), can be unknown; the rest of a failed lookup are asked
      // again later.
      const unanswered = new Set(result
        ? (Array.isArray(result.unanswered) ? result.unanswered : (result.reachable ? [] : toAsk))
        : toAsk);
      const failure = result?.failure || MINDSHUB_ERROR_CODE.UNREACHABLE;
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
        setFailed((current) => new Map([...current, ...notAsked.map((id) => [id, failure])]));
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

  /** Asks again, now, for every id that got no answer. */
  const retry = useCallback(() => {
    retryAll.current = true;
    setAttempt((n) => n + 1);
  }, []);

  const people = list.map((id) => {
    if (known.has(id)) return known.get(id);
    if (unknown.has(id)) return { id, name: null, email: null };
    if (failed.has(id)) return { id, name: null, email: null, failed: true };
    return { id, name: null, email: null, pending: true };
  });
  const failure = firstMindsHubFailure(people.filter((person) => person.failed).map((person) => failed.get(person.id)));
  return { people, remember, retry, failure };
}

/*
 * The org's people directory (`fetchMindsHubDirectory`), read once per
 * session and organization and shared by every recipient picker, so filtering
 * is local. A failed read shows as `error`, with `failure` (a
 * MINDSHUB_ERROR_CODE) saying why, until `retry` asks again or the
 * organization changes; one MindsHub refused, which offers no Retry, is
 * asked again when the next picker opens. `refresh` reads it again while the loaded list stays
 * in place (`refreshing`), for an address the list is too old to know; a
 * failed refresh keeps the list and sets `failure`. This is the app's one
 * copy of the directory, and `loadedAt` says how old it is.
 *
 * A `truncated` list stops before some members. `lookUp` asks MindsHub about
 * addresses it doesn't have (`fetchMindsHubPeopleByEmails`, `lookingUp`
 * meanwhile) and keeps each answer in `addresses`: the member who holds it,
 * or null when no member does. An address cowork-server refused as malformed
 * goes in `malformed` instead, since no lookup will ever find it. An address
 * MindsHub gave no answer about is left out of both, and `lookupFailure`
 * says why. A new read of the list drops the answers, which are as old as it.
 */
const NO_ADDRESSES = Object.freeze({});
const DIRECTORY_IDLE = Object.freeze({
  status: LOAD_STATUS.IDLE,
  people: [],
  truncated: false,
  loadedAt: 0,
  refreshing: false,
  failure: null,
  addresses: NO_ADDRESSES,
  malformed: NO_ADDRESSES,
  lookingUp: false,
  lookupFailure: null,
});

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
  Promise.resolve().then(() => fetchMindsHubDirectory()).catch(() => null).then((result) => {
    if (generation !== directoryGeneration) return;
    if (!result || !result.reachable) {
      onFailure(result?.failure || MINDSHUB_ERROR_CODE.UNREACHABLE);
      return;
    }
    setDirectory({
      ...DIRECTORY_IDLE,
      status: LOAD_STATUS.READY,
      people: result.people || [],
      truncated: result.truncated === true,
      loadedAt: Date.now(),
    });
  });
}

function loadDirectory() {
  if (directory.status === LOAD_STATUS.LOADING || directory.status === LOAD_STATUS.READY) return;
  const generation = directoryGeneration;
  setDirectory({ ...DIRECTORY_IDLE, status: LOAD_STATUS.LOADING });
  readDirectoryInto(generation, (failure) => setDirectory({ ...DIRECTORY_IDLE, status: LOAD_STATUS.ERROR, failure }));
}

/* Reads a loaded directory again. A failure keeps the list it had. */
function refreshDirectory() {
  if (directory.status !== LOAD_STATUS.READY || directory.refreshing) return;
  const generation = directoryGeneration;
  setDirectory({ ...directory, refreshing: true });
  readDirectoryInto(generation, (failure) => setDirectory({ ...directory, refreshing: false, failure }));
}

/** Whether the directory has an answer for `email` (lowercased): a member,
    no member, or refused as malformed. */
export function directoryAnswered(state, email) {
  return Object.hasOwn(state.addresses, email) || Object.hasOwn(state.malformed, email);
}

/* Asks MindsHub which members hold `emails` (lowercased), those not answered yet. */
function lookUpAddresses(emails) {
  if (directory.status !== LOAD_STATUS.READY || directory.lookingUp) return;
  const wanted = [...new Set(emails)].filter((email) => !directoryAnswered(directory, email));
  if (wanted.length === 0) return;
  const generation = directoryGeneration;
  setDirectory({ ...directory, lookingUp: true });
  Promise.resolve().then(() => fetchMindsHubPeopleByEmails(wanted)).catch(() => null).then((result) => {
    if (generation !== directoryGeneration) return;
    const unanswered = new Set(result ? result.unanswered || [] : wanted);
    const invalid = new Set(result?.invalid || []);
    const found = new Map((result?.people || []).map((person) => [person.email, person]));
    const addresses = { ...directory.addresses };
    const malformed = { ...directory.malformed };
    for (const email of wanted) {
      if (invalid.has(email)) malformed[email] = true;
      else if (found.has(email)) addresses[email] = found.get(email);
      else if (!unanswered.has(email)) addresses[email] = null;
    }
    const lookupFailure = unanswered.size ? (result?.failure || MINDSHUB_ERROR_CODE.UNREACHABLE) : null;
    setDirectory({ ...directory, addresses, malformed, lookingUp: false, lookupFailure });
  });
}

function subscribeDirectory(listener) {
  directoryListeners.add(listener);
  return () => directoryListeners.delete(listener);
}

const readDirectory = () => directory;

/**
 * Everyone in the org, for the recipient picker: `{ status, people,
 * truncated, loadedAt, refreshing, failure, addresses, malformed, lookingUp,
 * lookupFailure, retry, refresh, lookUp }`, `status` being a LOAD_STATUS.
 * Read the first time a picker is `active`; every later picker shares it.
 */
export function useOrgDirectory(active = true) {
  const state = useSyncExternalStore(subscribeDirectory, readDirectory, readDirectory);
  useEffect(() => {
    if (!active) return;
    // A read MindsHub refused offers no Retry, so the next picker to open
    // asks again.
    const refused = directory.status === LOAD_STATUS.ERROR && directory.failure === MINDSHUB_ERROR_CODE.REFUSED;
    if (directory.status === LOAD_STATUS.IDLE || refused) loadDirectory();
  }, [active]);
  const retry = useCallback(() => {
    if (directory.status === LOAD_STATUS.ERROR) {
      setDirectory(DIRECTORY_IDLE);
      loadDirectory();
    }
  }, []);
  return { ...state, retry, refresh: refreshDirectory, lookUp: lookUpAddresses };
}
