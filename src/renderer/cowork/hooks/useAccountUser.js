import { useEffect, useState } from 'react';
import { getAccessToken } from '../../platform/host';
import { accountUserFromToken } from '../lib/accountUser';

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
export function useAccountUser(isSsoConnected = false, { active = true } = {}) {
  const [accountUser, setAccountUser] = useState(null);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    getAccessToken().then((token) => {
      if (!cancelled) setAccountUser(accountUserFromToken(token));
    }).catch(() => { });
    return () => { cancelled = true; };
  }, [isSsoConnected, active]);

  return active ? accountUser : null;
}
