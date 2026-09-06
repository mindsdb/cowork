import { useEffect, useState } from 'react';
import { getAccessToken } from '../../platform/host';
import { accountUserFromToken } from '../lib/accountUser';

// Read identity on signed-in-state changes; discard stale token-refresh results after a newer run.
// Return null while loading or signed out.
export function useAccountUser(isSsoConnected = false) {
  const [accountUser, setAccountUser] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getAccessToken().then((token) => {
      if (!cancelled) setAccountUser(accountUserFromToken(token));
    }).catch(() => { });
    return () => { cancelled = true; };
  }, [isSsoConnected]);

  return accountUser;
}
