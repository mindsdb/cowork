import { useEffect, useState } from 'react';
import { fetchHubTeams, fetchSkillSharingCapabilities } from '../api';
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
