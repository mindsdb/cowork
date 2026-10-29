import { useEffect, useState } from 'react';
import { getAccessToken } from '../../platform/host';
import { accountUserFromToken } from '../lib/accountUser';

/*
 * The signed-in person's email from the access token, or null. Read only
 * while `active`, so a surface that doesn't need it never asks for a token.
 * The artifact Share panel uses it to guess which existing recipients are in
 * the org (ENG-3787).
 */
export function useAccountEmail(active) {
  const [email, setEmail] = useState(null);
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => getAccessToken())
      .then((token) => { if (live) setEmail(accountUserFromToken(token)?.email || null); })
      .catch(() => {});
    return () => { live = false; };
  }, [active]);
  return active ? email : null;
}
