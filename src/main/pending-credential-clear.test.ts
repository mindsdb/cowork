import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Which stores a sign-out marks for the sidecar to clear on its next start, run
// against a real directory tree so the partition resolution is the shipped one.
import {
  ACCOUNTS_DIR,
  ORGS_DIR,
  accountDataHome,
  claimDefaultRoot,
  claimForRecordedIncumbent,
  observePreExistingData,
  writeActiveOrgSync,
} from './account-data';
import {
  PENDING_CLEAR_MARKER,
  hasPendingCredentialClear,
  markStoresForCredentialClear,
  storesToClearAtSignOut,
} from './pending-credential-clear';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-pending-clear-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

/** The default root claimed by another account, so `acct-b` gets its own root. */
function defaultRootOwnedByAnother(): void {
  fs.writeFileSync(path.join(home, '.pre-existing-data'), JSON.stringify({ hadData: false, incumbent: null }));
  expect(claimDefaultRoot(home, 'acct-a').kind).toBe('claimed');
}

function store(...segments: string[]): string {
  const dir = path.join(home, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cowork.db'), '');
  return dir;
}

describe('storesToClearAtSignOut', () => {
  it('takes the account root and its organizations, never a sibling account', () => {
    defaultRootOwnedByAnother();
    const own = store(ACCOUNTS_DIR, 'acct-b');
    const ownOrg = store(ACCOUNTS_DIR, 'acct-b', ORGS_DIR, 'org-1');
    store(ACCOUNTS_DIR, 'acct-c');
    store(ACCOUNTS_DIR, 'acct-c', ORGS_DIR, 'org-1');

    const stores = storesToClearAtSignOut(home, { kind: 'signed-in', accountId: 'acct-b' }, null);

    expect(stores.sort()).toEqual([own, ownOrg].sort());
  });

  it('takes the default root and its organizations for the account that owns it, not the accounts beside it', () => {
    fs.writeFileSync(path.join(home, '.pre-existing-data'), JSON.stringify({ hadData: false, incumbent: null }));
    expect(claimDefaultRoot(home, 'acct-a').kind).toBe('claimed');
    store();
    const org = store(ORGS_DIR, 'org-1');
    store(ACCOUNTS_DIR, 'acct-b');

    const stores = storesToClearAtSignOut(home, { kind: 'signed-out', lastAccountId: 'acct-a' }, null);

    expect(stores.sort()).toEqual([home, org].sort());
  });

  it('skips a store with no database, since it holds no keys', () => {
    defaultRootOwnedByAnother();
    const own = store(ACCOUNTS_DIR, 'acct-b');
    fs.mkdirSync(path.join(own, ORGS_DIR, 'never-started'), { recursive: true });

    const stores = storesToClearAtSignOut(home, { kind: 'signed-in', accountId: 'acct-b' }, null);

    expect(stores).toEqual([own]);
  });

  it('keeps the store a sidecar is starting on even before its database exists', () => {
    defaultRootOwnedByAnother();
    store(ACCOUNTS_DIR, 'acct-b');
    const starting = path.join(home, ACCOUNTS_DIR, 'acct-b', ORGS_DIR, 'org-new');

    const stores = storesToClearAtSignOut(home, { kind: 'signed-in', accountId: 'acct-b' }, starting);

    expect(stores).toContain(starting);
  });

  it('ignores an active store outside the account being signed out', () => {
    defaultRootOwnedByAnother();
    const own = store(ACCOUNTS_DIR, 'acct-b');
    const elsewhere = path.join(home, ACCOUNTS_DIR, 'acct-c');

    const stores = storesToClearAtSignOut(home, { kind: 'signed-in', accountId: 'acct-b' }, elsewhere);

    expect(stores).toEqual([own]);
  });

  it('takes the quarantine root for a session that cannot be named', () => {
    observePreExistingData(home);
    const quarantine = accountDataHome(home, { kind: 'unresolved' });
    fs.mkdirSync(quarantine, { recursive: true });
    fs.writeFileSync(path.join(quarantine, 'cowork.db'), '');
    store(ACCOUNTS_DIR, 'acct-b');

    const stores = storesToClearAtSignOut(home, { kind: 'unresolved' }, null);

    expect(stores).toEqual([quarantine]);
  });

  it('takes every organization of the recorded incumbent before its session is re-established', () => {
    store();
    observePreExistingData(home, 'acct-a');
    expect(claimForRecordedIncumbent(home)).toBe('acct-a');
    const org = store(ORGS_DIR, 'org-1');

    const stores = storesToClearAtSignOut(home, { kind: 'unknown' }, null);

    expect(stores.sort()).toEqual([home, org].sort());
  });

  it('takes only the resolved store for an unnamed session on a root nobody is recorded as owning', () => {
    observePreExistingData(home);
    store();
    const resolved = store(ORGS_DIR, 'org-1');
    store(ORGS_DIR, 'org-2');
    writeActiveOrgSync(home, 'org-1');

    const stores = storesToClearAtSignOut(home, { kind: 'unknown' }, null);

    expect(stores).toEqual([resolved]);
  });
});

describe('markStoresForCredentialClear', () => {
  it('drops a marker in each store', () => {
    const a = store('a');
    const b = store('b');

    markStoresForCredentialClear([a, b], null);

    expect(hasPendingCredentialClear(a)).toBe(true);
    expect(hasPendingCredentialClear(b)).toBe(true);
    expect(fs.existsSync(path.join(a, PENDING_CLEAR_MARKER))).toBe(true);
  });

  it('creates the directory only for the store a sidecar is starting on', () => {
    const starting = path.join(home, ORGS_DIR, 'org-new');
    const vanished = path.join(home, ORGS_DIR, 'org-gone');

    markStoresForCredentialClear([starting, vanished], starting);

    expect(hasPendingCredentialClear(starting)).toBe(true);
    expect(fs.existsSync(vanished)).toBe(false);
  });

  it('marks the rest when one store cannot be written', () => {
    const missing = path.join(home, 'missing');
    const present = store('present');

    expect(() => markStoresForCredentialClear([missing, present], null)).not.toThrow();

    expect(hasPendingCredentialClear(present)).toBe(true);
  });
});
