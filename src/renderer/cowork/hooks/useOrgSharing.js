import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHubPeopleByIds, fetchHubTeams, fetchSkillSharingCapabilities } from '../api';
import { subscribeOrganizationChanges } from '../lib/organizationChanges';

/*
 * What org sharing (ENG-3787) allows here, and the caller's teams. Both are
 * read once per organization and shared by every surface that asks: the
 * Skills page, the skill Share dialog and the artifact Share panel.
 *
 * Until the answer lands, and on any failure, sharing reads as off, so those
 * surfaces render exactly as they do on a build without it.
 */

const OFF = Object.freeze({ enabled: false, can_share_org: false, can_write_org: false, org_name: null });

let capabilitiesPromise = null;
let teamsPromise = null;

subscribeOrganizationChanges(() => {
  capabilitiesPromise = null;
  teamsPromise = null;
});

function loadCapabilities() {
  if (!capabilitiesPromise) {
    capabilitiesPromise = Promise.resolve().then(() => fetchSkillSharingCapabilities()).catch(() => {
      // A failed read is retried on the next mount rather than cached as off.
      capabilitiesPromise = null;
      return OFF;
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
}

/** `{ enabled, can_share_org, can_write_org, org_name }`; off until known,
    and not asked while `active` is false. */
export function useSharingCapabilities(active = true) {
  const [capabilities, setCapabilities] = useState(OFF);
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    loadCapabilities().then((next) => { if (live) setCapabilities(next); });
    return () => { live = false; };
  }, [active]);
  return active ? capabilities : OFF;
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

/**
 * The people an audience names by user id (`allowed_user_ids`), as the
 * `<PeoplePicker>` shows them: `{ id, name, email }` once the hub has named
 * them, `{ id, pending: true }` while it's being asked, and `{ id, name: null,
 * email: null }` for an id it doesn't know (an "Unknown person" chip).
 *
 * Ids are asked once each (`fetchHubPeopleByIds`); `remember` records people
 * the picker found, so a pick is never looked up again. `unreachable` is true
 * when the hub couldn't be asked about some of them.
 */
export function useKnownPeople(ids) {
  const [known, setKnown] = useState(() => new Map());
  const [unknown, setUnknown] = useState(() => new Set());
  const [unreachable, setUnreachable] = useState(false);
  const asked = useRef(new Set());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const list = ids || [];
  const key = list.join(',');
  useEffect(() => {
    const toAsk = list.filter((id) => !known.has(id) && !asked.current.has(id));
    if (toAsk.length === 0) return;
    for (const id of toAsk) asked.current.add(id);
    // Not cancelled when the ids change: an answer for an id that has since
    // been removed is harmless, and dropping it would leave the rest pending.
    fetchHubPeopleByIds(toAsk).then((result) => {
      if (!live.current) return;
      const found = new Map(result.people.map((person) => [person.id, person]));
      setKnown((current) => {
        const next = new Map(current);
        for (const [id, person] of found) next.set(id, person);
        return next;
      });
      setUnknown((current) => {
        const next = new Set(current);
        for (const id of toAsk) if (!found.has(id)) next.add(id);
        return next;
      });
      if (!result.reachable) setUnreachable(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const remember = useCallback((people) => {
    setKnown((current) => {
      const next = new Map(current);
      for (const person of people || []) if (person?.id && person.email) next.set(person.id, person);
      return next;
    });
  }, []);

  const people = list.map((id) => known.get(id)
    || (unknown.has(id) ? { id, name: null, email: null } : { id, name: null, email: null, pending: true }));
  return { people, remember, unreachable };
}
