import { useEffect, useState } from 'react';
import {
  isElectron, mindshubArtifactSharePermission, onMindsHubAuthChanged, onMindsHubCredentialChanged,
} from '../../platform/host';
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
 * Main keeps auth's answer per person and organization for a few minutes,
 * and checks for a pasted key on every call. This asks once per mount and
 * organization, and again whenever the credential or the sign-in changes
 * while a viewer stays open: a key pasted meanwhile must take the card away.
 */

const OFF = Object.freeze({ status: LOAD_STATUS.IDLE, capabilities: SHARING_OFF, orgName: null });
const LOADING = Object.freeze({ status: LOAD_STATUS.LOADING, capabilities: SHARING_OFF, orgName: null });
const NO_ANSWER = Object.freeze({ key: null, value: null });

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
  const [answer, setAnswer] = useState(NO_ANSWER);
  const [credentialVersion, setCredentialVersion] = useState(0);

  useEffect(() => {
    if (!key) return undefined;
    // A new credential may be a pasted key: drop the answer so the card is
    // off until main answers for it. A sign-in change only asks again.
    const offCredential = onMindsHubCredentialChanged(() => {
      setAnswer(NO_ANSWER);
      setCredentialVersion((n) => n + 1);
    });
    const offAuth = onMindsHubAuthChanged(() => setCredentialVersion((n) => n + 1));
    return () => { offCredential(); offAuth(); };
  }, [key]);

  useEffect(() => {
    // Forget the answer once there is no key, so coming back to the same
    // organization never shows it before main answers again.
    if (!key) {
      setAnswer(NO_ANSWER);
      return undefined;
    }
    let live = true;
    Promise.resolve()
      .then(() => mindshubArtifactSharePermission())
      .catch(() => null)
      .then((value) => { if (live) setAnswer({ key, value }); });
    return () => { live = false; };
  }, [key, credentialVersion]);

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
