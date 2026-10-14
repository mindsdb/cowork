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

// Whether the last server to answer reads markers, kept for a run whose server
// never comes up. Neither file means unknown: none has answered since install.
const SERVER_CLEARS_FILE = '.server-clears-pending-credentials';
const SERVER_IGNORES_FILE = '.server-ignores-pending-credentials';

// The markers a sign-out wrote before any server had said whether it reads
// them, one store root per line, kept until the next server answers.
const UNCONFIRMED_CLEARS_FILE = '.pending-credential-clear-unconfirmed';

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
 * on, or null, and `serverClears` whether the installed server reads markers,
 * null when no server has said.
 * Returns the store roots to mark: none for a server that ignores markers,
 * since a later upgrade would consume them and clear keys entered in between.
 * An unknown server is marked anyway, through `markStoresForSignOut`, which
 * keeps the list so the first answer can take the markers back.
 * A store with no database is left out, as it holds no keys, except the
 * active one, whose sidecar may not have created it yet.
 */
export function storesToClearAtSignOut(
  home: string,
  active: ActiveAccount,
  activeStore: string | null,
  serverClears: boolean | null,
): string[] {
  if (serverClears === false) return [];
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
 * Side effects: writes one of two files in `home` and removes the other. Best
 * effort: a lost write only means one sign-out falls back to the previous answer.
 */
export function recordServerClearsPendingCredentials(home: string, clears: boolean): void {
  const [keep, drop] = clears ? [SERVER_CLEARS_FILE, SERVER_IGNORES_FILE] : [SERVER_IGNORES_FILE, SERVER_CLEARS_FILE];
  try {
    fs.writeFileSync(path.join(home, keep), '', { encoding: 'utf-8', mode: 0o600 });
    fs.rmSync(path.join(home, drop), { force: true });
  } catch (err) {
    console.warn('[server] could not record whether the backend clears a pending store', err);
  }
}

/** Whether the server this install last started reads markers, as recorded on
 *  disk, or null when no server has ever answered. */
export function installedServerClearsPendingCredentials(home: string): boolean | null {
  if (fs.existsSync(path.join(home, SERVER_CLEARS_FILE))) return true;
  if (fs.existsSync(path.join(home, SERVER_IGNORES_FILE))) return false;
  return null;
}

/**
 * Keep the stores a sign-out is about to mark before any server has said
 * whether it reads markers, so the first answer can settle them.
 *
 * Args: `home` is the shared Cowork home; `stores` the roots to be marked.
 * Returns whether the list now holds them.
 * Side effects: appends to a file in `home`.
 */
export function holdUnconfirmedClears(home: string, stores: string[]): boolean {
  if (stores.length === 0) return true;
  try {
    fs.appendFileSync(path.join(home, UNCONFIRMED_CLEARS_FILE), stores.map((s) => `${s}\n`).join(''), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    return true;
  } catch (err) {
    console.warn('[logout] could not record the stores marked before the backend answered', err);
    return false;
  }
}

/**
 * Mark the stores a sign-out clears. While no server has said whether it reads
 * markers, the list is written first and the markers only if it held: a marker
 * nobody can take back would wait for a later upgrade and clear keys entered
 * in between.
 *
 * Args: `home` is the shared Cowork home; `stores` from `storesToClearAtSignOut`;
 * `activeStore` as for `markStoresForCredentialClear`; `serverClears` the
 * capability read with the stores, null when unknown.
 * Side effects: writes the list when unknown, then the markers.
 */
export function markStoresForSignOut(
  home: string,
  stores: string[],
  activeStore: string | null,
  serverClears: boolean | null,
): void {
  if (serverClears === null && !holdUnconfirmedClears(home, stores)) return;
  markStoresForCredentialClear(stores, activeStore);
}

/**
 * Forget what the last server said about markers, because the install it
 * described is about to be replaced.
 *
 * Args: `home` is the shared Cowork home.
 * Side effects: removes both record files. Held markers and their list stay.
 */
export function forgetServerClearsPendingCredentials(home: string): void {
  for (const name of [SERVER_CLEARS_FILE, SERVER_IGNORES_FILE]) {
    try {
      fs.rmSync(path.join(home, name), { force: true });
    } catch (err) {
      console.warn('[server] could not forget what the replaced backend said about pending stores', err);
    }
  }
}

/**
 * Settle the markers held by `holdUnconfirmedClears` once a server answers.
 * A server that reads them has already cleared the store it started on and
 * will clear the rest on their next start. One that ignores them would leave
 * them for a later upgrade to consume, after new keys were entered, so they
 * are taken back here, before this server can be handed any.
 *
 * Args: `home` is the shared Cowork home; `clears` what the server's /health said.
 * Side effects: removes the held markers when `clears` is false, then the list.
 */
export function settleUnconfirmedClears(home: string, clears: boolean): void {
  const file = path.join(home, UNCONFIRMED_CLEARS_FILE);
  if (!fs.existsSync(file)) return;
  try {
    if (!clears) {
      const stores = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
      for (const root of stores) fs.rmSync(path.join(root, PENDING_CLEAR_MARKER), { force: true });
    }
    fs.rmSync(file, { force: true });
  } catch (err) {
    console.warn('[server] could not settle the stores marked before the backend answered', err);
  }
}
