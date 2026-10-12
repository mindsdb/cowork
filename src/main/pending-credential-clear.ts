// Which stores a sign-out asks the sidecar to clear before they serve again.
//
// Sign-out can only clear the provider keys of the store a sidecar is serving,
// and only if it answers in time. Every other store of the account, each
// organization's own `cowork.db`, would keep its keys. So sign-out drops a
// marker beside each of them, and cowork-server clears that store's credentials
// at startup, before it binds, whenever it finds one
// (`cowork/services/pending_credential_clear.py`, same marker name).
//
// Main only writes markers. It reads them for one decision: never adopting a
// running sidecar for a marked store, since an adopted process never re-runs
// its startup.

import * as fs from 'fs';
import * as path from 'path';
import {
  ORGS_DIR,
  accountDataHome,
  listOrgSegments,
  orgStoreRoot,
  readAccountClaim,
  readActiveOrg,
  recordedIncumbent,
  type ActiveAccount,
} from './account-data';

export const PENDING_CLEAR_MARKER = '.pending-credential-clear';

/** The start of the line cowork-server logs when it cannot finish a clear,
 *  which is how a start that died on it is told apart from any other exit. */
export const PENDING_CLEAR_FAILURE_LOG = 'pending credential clear failed';

/** The `/health` capability of a sidecar that consumes the marker. */
export const PENDING_CLEAR_CAPABILITY = 'pending-credential-clear';

const STORE_DATABASE = 'cowork.db';

// Present when the last server this install started reads markers. On disk so a
// run whose server never comes up still knows, at sign-out, whether to mark.
const SERVER_CLEARS_FILE = '.server-clears-pending-credentials';

/** An account root and every organization store under it. */
function accountStores(accountRoot: string): string[] {
  return [
    accountRoot,
    ...listOrgSegments(accountRoot).map((segment) => path.join(accountRoot, ORGS_DIR, segment)),
  ];
}

/** Whether the default root belongs to the account recorded as its incumbent,
 *  so its organizations are that account's own. */
function incumbentOwnsDefaultRoot(home: string): boolean {
  const claim = readAccountClaim(home);
  return claim.kind === 'claimed' && claim.accountId === recordedIncumbent(home);
}

/**
 * The stores a sign-out marks, read before the token clear lifts the in-memory
 * quarantine, so a session that cannot be named marks its quarantine root and
 * never the account a stale record names.
 *
 * An `unknown` session takes only the store it resolves to, unless the default
 * root is the recorded incumbent's: a session with no record can sit there for
 * an account that is not the incumbent, and those organizations are not its.
 *
 * Args: `home` is the shared Cowork home, `active` the session read at
 * sign-out entry, `activeStore` the store a sidecar is running or starting
 * on, or null, and `serverClears` whether the installed server reads markers.
 * Returns the store roots to mark: none for a server that ignores markers,
 * since a later upgrade would consume them and clear keys entered in between.
 * A store with no database is left out, as it holds no keys, except the
 * active one, whose sidecar may not have created it yet.
 */
export function storesToClearAtSignOut(
  home: string,
  active: ActiveAccount,
  activeStore: string | null,
  serverClears: boolean,
): string[] {
  if (!serverClears) return [];
  const accountRoot = accountDataHome(home, active);
  let candidates: string[];
  if (active.kind !== 'unknown') {
    candidates = accountStores(accountRoot);
  } else if (accountRoot === home && incumbentOwnsDefaultRoot(home)) {
    candidates = accountStores(home);
  } else {
    candidates = [orgStoreRoot(accountRoot, readActiveOrg(accountRoot))];
  }

  const stores = candidates.filter((root) => fs.existsSync(path.join(root, STORE_DATABASE)));
  const activeIsCandidate = activeStore !== null
    && (activeStore === accountRoot || path.dirname(activeStore) === path.join(accountRoot, ORGS_DIR));
  if (activeIsCandidate && !stores.includes(activeStore)) stores.push(activeStore);
  return stores;
}

/**
 * Drop a marker in each store. Best effort per store, so one that cannot be
 * written never stops the rest or the sign-out.
 *
 * Args: `stores` from `storesToClearAtSignOut`; `activeStore` is the only one
 * whose directory may be created, because its sidecar is about to create it
 * anyway. Creating any other would read as a new partition.
 * Side effects: writes the marker files.
 */
export function markStoresForCredentialClear(stores: string[], activeStore: string | null): void {
  for (const root of stores) {
    try {
      if (root === activeStore) fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, PENDING_CLEAR_MARKER), '', { encoding: 'utf-8', mode: 0o600 });
    } catch (err) {
      console.warn('[logout] could not mark a store for its credential clear: %s', root, err);
    }
  }
}

/** Whether a store still has a clear pending. */
export function hasPendingCredentialClear(storeRoot: string): boolean {
  return fs.existsSync(path.join(storeRoot, PENDING_CLEAR_MARKER));
}

/**
 * Record whether the server this install just started reads markers.
 *
 * Args: `home` is the shared Cowork home; `clears` what its /health said.
 * Side effects: writes or removes a file in `home`. Best effort: a lost write
 * only means one sign-out falls back to the previous answer.
 */
export function recordServerClearsPendingCredentials(home: string, clears: boolean): void {
  const file = path.join(home, SERVER_CLEARS_FILE);
  try {
    if (clears) fs.writeFileSync(file, '', { encoding: 'utf-8', mode: 0o600 });
    else fs.rmSync(file, { force: true });
  } catch (err) {
    console.warn('[server] could not record whether the backend clears a pending store', err);
  }
}

/** Whether the server this install last started reads markers, as recorded on
 *  disk. False when nothing has been recorded. */
export function installedServerClearsPendingCredentials(home: string): boolean {
  return fs.existsSync(path.join(home, SERVER_CLEARS_FILE));
}
