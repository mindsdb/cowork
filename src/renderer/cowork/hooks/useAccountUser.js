import { useEffect, useState } from 'react';
import { getAccessToken } from '../../platform/host';
import { accountUserFromToken } from '../lib/accountUser';
import { subscribeOrganizationChanges } from '../lib/organizationChanges';

// The signed-in account identity, decoded from the access token — null while
// loading and when signed out. Shared by the settings Account section and the
// sidebar user menu.
//
// Re-runs when the signed-in state flips (ENG-761): previously signing in
// while a consumer was already mounted never re-read the token — the UI
// stayed on its signed-out state. The cancelled guard means a stale
// resolution (from a slow network refresh in getAccessToken) can't overwrite
// a newer run.
//
// `active` false reads no token and answers null, for a surface that needs
// the account only while one of its features is on (useSharingOrgName).
//
// Also re-reads after an in-place organization switch (a newer UI on an older
// desktop shell), so console links never name the org just left (ENG-4333).
export function useAccountUser(isSsoConnected = false, { active = true } = {}) {
  const [accountUser, setAccountUser] = useState(null);
  const [orgVersion, setOrgVersion] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    return subscribeOrganizationChanges(() => setOrgVersion((v) => v + 1));
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    getAccessToken().then((token) => {
      if (!cancelled) setAccountUser(accountUserFromToken(token));
    }).catch(() => { });
    return () => { cancelled = true; };
  }, [isSsoConnected, active, orgVersion]);

  return active ? accountUser : null;
}
