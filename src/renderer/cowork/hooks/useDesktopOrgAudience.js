import { useEffect, useState } from 'react';
import { isElectron, mindshubArtifactSharePermission } from '../../platform/host';
import { subscribeOrganizationChanges } from '../lib/organizationChanges';
import { SHARING_OFF } from '../lib/orgSharing';
import { LOAD_STATUS } from '../lib/sharingContract';
import { useAccountUser } from './useAccountUser';
import { useSharingOrgName } from './useOrgSharing';

/*
 * "Everyone at ‹org›" on Desktop. Desktop publishes through /publish, which
 * takes `org_allowed` and nothing else of org sharing, so this turns on that
 * one card (`orgAudience`) and never `enabled`, which would also turn on
 * teams, people and skill sharing.
 *
 * usePublish is active whenever a viewer is open, not only the Share panel,
 * so the permission main reads from auth is kept per person and organization.
 * Only a known answer is kept: one auth couldn't give, and one for a pasted
 * key (which main answers without asking auth), are asked again next time.
 */

const OFF = Object.freeze({ status: LOAD_STATUS.IDLE, capabilities: SHARING_OFF, orgName: null });
const LOADING = Object.freeze({ status: LOAD_STATUS.LOADING, capabilities: SHARING_OFF, orgName: null });

let cached = { key: null, promise: null };

subscribeOrganizationChanges(() => { cached = { key: null, promise: null }; });

function loadPermission(key) {
  if (cached.key === key && cached.promise) return cached.promise;
  const promise = Promise.resolve()
    .then(() => mindshubArtifactSharePermission())
    .then((answer) => {
      if (answer?.known !== true && cached.promise === promise) cached = { key: null, promise: null };
      return answer;
    }, () => {
      if (cached.promise === promise) cached = { key: null, promise: null };
      return null;
    });
  cached = { key, promise };
  return promise;
}

/** For tests: forget what was read. */
export function __resetDesktopOrgAudienceForTests() {
  cached = { key: null, promise: null };
}

/**
 * The Desktop organization audience for the artifact Share panel:
 * `{ status, capabilities, orgName }`. `active` is false in MindsHub mode and
 * while no viewer or doc share is open; then nothing is read. The card is off
 * until main answers, on web, signed out, in a personal organization, with a
 * pasted key, and on a desktop shell older than the call.
 */
export function useDesktopOrgAudience(active) {
  const reading = active === true && isElectron;
  const accountUser = useAccountUser(false, { active: reading });
  const eligible = reading && !!accountUser?.org && !accountUser.orgIsPersonal;
  const key = eligible ? `${accountUser.sub}:${accountUser.orgId}` : null;
  const [answer, setAnswer] = useState({ key: null, value: null });

  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    loadPermission(key).then((value) => { if (live) setAnswer({ key, value }); });
    return () => { live = false; };
  }, [key]);

  const value = answer.key === key ? answer.value : null;
  const on = !!key && !!value && value.sessionCredential !== false;
  // The name can lag main's answer: none until the token is read, then the
  // token's organization name, then the list's display name, as on Web.
  const orgName = useSharingOrgName(on);

  if (!key) return OFF;
  if (answer.key !== key) return LOADING;
  if (!on) return { status: LOAD_STATUS.READY, capabilities: SHARING_OFF, orgName: null };
  return {
    status: LOAD_STATUS.READY,
    capabilities: {
      enabled: false,
      orgAudience: true,
      canShareSkillsOrg: false,
      canWriteSkillsOrg: false,
      canShareArtifactsOrg: value.canShareArtifactsOrg === true,
      permissionsKnown: value.known === true,
      teamsKnown: true,
    },
    orgName,
  };
}

export default useDesktopOrgAudience;
