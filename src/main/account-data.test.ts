import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// This module decides which account's data a session reads, so the whole
// resolution table is enumerated below rather than sampled. The cells that cost
// earlier attempts a real bug are called out where they appear: an account
// taking data it cannot prove is its own, and a session that cannot name itself
// being sent away from data that was already its own.
import {
  accountDataHome,
  accountOwnerToken,
  adoptDefaultRootAsIncumbent,
  claimDefaultRoot,
  declineDefaultRoot,
  hadPreExistingData,
  hasDeclinedDefaultRoot,
  knownAccountRoots,
  needsOwnershipDecision,
  observePreExistingData,
  readAccountClaim,
  readActiveAccount,
  resolveAccountRoot,
  sidecarEnvForSession,
  sweepStaleQuarantineRoots,
  writeActiveAccount,
  writeActiveAccountSync,
} from './account-data';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const signedIn = (accountId: string) => ({ kind: 'signed-in' as const, accountId });
const signedOut = (lastAccountId: string | null) => ({
  kind: 'signed-out' as const,
  lastAccountId,
});
const NEVER = { kind: 'unknown' as const };

let home: string;

/** An install that already held data when this build first ran. */
const upgraded = () => {
  fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
  observePreExistingData(home);
};
/** A fresh install: the observation happens before any database exists. */
const fresh = () => observePreExistingData(home);

const accountRoot = (id: string) => path.join(home, 'accounts', id);
const makeAccountRoot = (id: string) => fs.mkdirSync(accountRoot(id), { recursive: true });

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-account-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('observing whether the install already had data', () => {
  it('records false for a fresh install', () => {
    fresh();
    expect(hadPreExistingData(home)).toBe(false);
  });

  it('records true for an install that already had a database', () => {
    upgraded();
    expect(hadPreExistingData(home)).toBe(true);
  });

  it('does not change its mind once the sidecar creates a database', () => {
    // The whole point: after the first server start every install looks like it
    // has data, so a live test would ask a brand-new user whose data theirs is.
    fresh();
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(home);
    expect(hadPreExistingData(home)).toBe(false);
  });

  it('reads an unrecorded answer as "had data", which is the safe direction', () => {
    expect(hadPreExistingData(home)).toBe(true);
  });
});

describe('resolveAccountRoot - signed in', () => {
  it('claimed by this account -> the default root', () => {
    fresh();
    claimDefaultRoot(home, A);
    expect(resolveAccountRoot(home, signedIn(A))).toBeNull();
  });

  it('claimed by another -> its own root', () => {
    fresh();
    claimDefaultRoot(home, A);
    expect(resolveAccountRoot(home, signedIn(B))).toBe(B);
  });

  it('unclaimed with no old data -> the default root', () => {
    fresh();
    expect(resolveAccountRoot(home, signedIn(A))).toBeNull();
  });

  it('unclaimed WITH old data -> its own root, and it gets asked', () => {
    // Nothing on disk says whose that data is. Taking it is the reported bug.
    upgraded();
    expect(resolveAccountRoot(home, signedIn(A))).toBe(A);
    expect(needsOwnershipDecision(home, signedIn(A))).toBe(true);
  });

  it('unreadable claim -> its own root', () => {
    fresh();
    fs.writeFileSync(path.join(home, '.account'), 'corrupt', 'utf-8');
    expect(resolveAccountRoot(home, signedIn(A))).toBe(A);
  });

  it('an unusable recorded id quarantines instead of throwing', () => {
    // Three callers in server-process.ts are not inside a try, so throwing here
    // would stop the sidecar starting on every launch with no way back.
    fresh();
    expect(resolveAccountRoot(home, signedIn('../escape'))).toMatch(/^_unresolved-/);
  });
});

describe('resolveAccountRoot - signed out', () => {
  it('follows the account it last was, not the owner of the default root', () => {
    // Otherwise sign-out scrubs the OWNER's credentials and provider picks.
    fresh();
    claimDefaultRoot(home, A);
    expect(resolveAccountRoot(home, signedOut(B))).toBe(B);
  });

  it('the owner signed out stays on the default root', () => {
    fresh();
    claimDefaultRoot(home, A);
    expect(resolveAccountRoot(home, signedOut(A))).toBeNull();
  });

  it('unclaimed with no old data -> the default root', () => {
    fresh();
    expect(resolveAccountRoot(home, signedOut(A))).toBeNull();
  });

  it('unclaimed with old data -> its own root', () => {
    upgraded();
    expect(resolveAccountRoot(home, signedOut(B))).toBe(B);
  });

  it('unreadable claim -> its own root', () => {
    fresh();
    fs.writeFileSync(path.join(home, '.account'), 'corrupt', 'utf-8');
    expect(resolveAccountRoot(home, signedOut(B))).toBe(B);
  });
});

describe('resolveAccountRoot - never signed in', () => {
  it('keeps its own data when nobody has ever been partitioned here', () => {
    // The case that cost the previous attempt an install's whole history: a
    // desktop on local provider keys that never signed in to MindsHub. There is
    // no second identity to leak to, so it stays where it always was.
    upgraded();
    expect(resolveAccountRoot(home, NEVER)).toBeNull();
    expect(resolveAccountRoot(home, signedOut(null))).toBeNull();
  });

  it('is quarantined once another account has a root here', () => {
    // Now there IS someone to leak to, and we cannot show the data is ours.
    upgraded();
    makeAccountRoot(A);
    expect(resolveAccountRoot(home, NEVER)).toMatch(/^_unresolved-/);
  });

  it('is not fooled by a leftover quarantine root', () => {
    // Counting those as occupants would strand an install permanently after one
    // launch that could not name its account.
    upgraded();
    makeAccountRoot('_unresolved-deadbeef');
    expect(resolveAccountRoot(home, NEVER)).toBeNull();
  });

  it('is quarantined when someone owns the default root', () => {
    fresh();
    claimDefaultRoot(home, A);
    expect(resolveAccountRoot(home, NEVER)).toMatch(/^_unresolved-/);
  });

  it('is quarantined when the claim is unreadable', () => {
    fresh();
    fs.writeFileSync(path.join(home, '.account'), 'corrupt', 'utf-8');
    expect(resolveAccountRoot(home, NEVER)).toMatch(/^_unresolved-/);
  });

  it('a fresh install with no data at all stays on the default root', () => {
    fresh();
    expect(resolveAccountRoot(home, NEVER)).toBeNull();
  });
});

describe('resolveAccountRoot writes nothing', () => {
  it('so the probe and spawn paths cannot disagree', () => {
    upgraded();
    const before = fs.readdirSync(home).sort();
    resolveAccountRoot(home, signedIn(A));
    resolveAccountRoot(home, NEVER);
    resolveAccountRoot(home, signedOut(B));
    expect(fs.readdirSync(home).sort()).toEqual(before);
  });
});

describe('the sidecar environment', () => {
  it('is empty for the account on the default root', () => {
    // Which is what keeps a single-account install byte-identical to today,
    // including prod's legacy ~/.anton/.env fallback, dropped only when
    // COWORK_HOME is set.
    fresh();
    claimDefaultRoot(home, A);
    expect(sidecarEnvForSession(home, signedIn(A))).toEqual({});
    expect(accountDataHome(home, signedIn(A))).toBe(home);
  });

  it('is one variable for any other account', () => {
    // cowork-server derives every store, the master key and the dotenv chain
    // from it; test_cowork_home.py pins that.
    fresh();
    claimDefaultRoot(home, A);
    expect(sidecarEnvForSession(home, signedIn(B))).toEqual({
      COWORK_HOME: accountRoot(B),
    });
    expect(accountDataHome(home, signedIn(B))).toBe(accountRoot(B));
  });
});

describe('claiming the default root', () => {
  it('a fresh install claims it at sign-in', () => {
    fresh();
    expect(claimDefaultRoot(home, A)).toEqual({ kind: 'claimed', accountId: A });
  });

  it('a sign-in cannot take a root that held pre-existing data', () => {
    upgraded();
    expect(claimDefaultRoot(home, B)).toEqual({ kind: 'unclaimed' });
    expect(fs.existsSync(path.join(home, '.account'))).toBe(false);
  });

  it('only the answered dialog can hand that root over', () => {
    upgraded();
    expect(adoptDefaultRootAsIncumbent(home, A)).toEqual({ kind: 'claimed', accountId: A });
    expect(resolveAccountRoot(home, signedIn(A))).toBeNull();
    expect(needsOwnershipDecision(home, signedIn(A))).toBe(false);
  });

  it('never steals a claim, and never overwrites one', () => {
    fresh();
    claimDefaultRoot(home, A);
    expect(claimDefaultRoot(home, B)).toEqual({ kind: 'claimed', accountId: A });
    expect(adoptDefaultRootAsIncumbent(home, B)).toEqual({ kind: 'claimed', accountId: A });
    expect(readAccountClaim(home)).toEqual({ kind: 'claimed', accountId: A });
  });

  it('reports unreadable when the claim cannot be written', () => {
    fresh();
    fs.mkdirSync(path.join(home, '.account'));
    expect(claimDefaultRoot(home, A)).toEqual({ kind: 'unreadable' });
  });
});

describe('the ownership question', () => {
  it('is not asked on a fresh install', () => {
    fresh();
    expect(needsOwnershipDecision(home, signedIn(A))).toBe(false);
  });

  it('is not asked of a session that is not signed in', () => {
    upgraded();
    expect(needsOwnershipDecision(home, signedOut(A))).toBe(false);
    expect(needsOwnershipDecision(home, NEVER)).toBe(false);
  });

  it('stops being asked after "start fresh", and leaves the data alone', () => {
    upgraded();
    declineDefaultRoot(home, B);
    expect(hasDeclinedDefaultRoot(home, B)).toBe(true);
    expect(needsOwnershipDecision(home, signedIn(B))).toBe(false);
    expect(fs.existsSync(path.join(home, 'cowork.db'))).toBe(true);
  });

  it('remembers that per account, and survives the record being rewritten', async () => {
    upgraded();
    declineDefaultRoot(home, B);
    await writeActiveAccount(home, B);
    expect(needsOwnershipDecision(home, signedIn(B))).toBe(false);
    expect(needsOwnershipDecision(home, signedIn(A))).toBe(true);
  });
});

describe('the active-account record', () => {
  it('round-trips a signed-in account', async () => {
    expect(readActiveAccount(home)).toEqual(NEVER);
    await writeActiveAccount(home, A);
    expect(readActiveAccount(home)).toEqual(signedIn(A));
  });

  it('keeps the account across a sign-out', async () => {
    await writeActiveAccount(home, A);
    await writeActiveAccount(home, null);
    expect(readActiveAccount(home)).toEqual(signedOut(A));
  });

  it('reads a corrupt record as never-signed-in', () => {
    fs.writeFileSync(path.join(home, 'active-account.json'), '{ broken', 'utf-8');
    expect(readActiveAccount(home)).toEqual(NEVER);
  });

  it('refuses to record an unsafe id', async () => {
    await expect(writeActiveAccount(home, '../escape')).rejects.toThrow(/unexpected account id/);
  });
});

describe('stale quarantine roots', () => {
  it('an empty one is removed', () => {
    makeAccountRoot('_unresolved-deadbeef');
    sweepStaleQuarantineRoots(home);
    expect(fs.existsSync(accountRoot('_unresolved-deadbeef'))).toBe(false);
  });

  it('one holding work is left for a support path, not tidied away', () => {
    makeAccountRoot('_unresolved-deadbeef');
    fs.writeFileSync(path.join(accountRoot('_unresolved-deadbeef'), 'cowork.db'), 'x', 'utf-8');
    sweepStaleQuarantineRoots(home);
    expect(fs.existsSync(path.join(accountRoot('_unresolved-deadbeef'), 'cowork.db'))).toBe(true);
  });

  it('a real account root is never swept', () => {
    makeAccountRoot(B);
    sweepStaleQuarantineRoots(home);
    expect(fs.existsSync(accountRoot(B))).toBe(true);
    expect(knownAccountRoots(home)).toContain(B);
  });
});

describe('accountOwnerToken', () => {
  const SECRET = 'a-server-owner-secret';

  it('is the secret itself when there is no account', () => {
    expect(accountOwnerToken(SECRET, null)).toBe(SECRET);
  });

  it('differs per account so one cannot adopt another server', () => {
    const a = accountOwnerToken(SECRET, A);
    expect(a).not.toBe(accountOwnerToken(SECRET, B));
    expect(a).not.toBe(SECRET);
    expect(a).not.toContain(SECRET);
    expect(accountOwnerToken(SECRET, A)).toBe(a);
  });
});

describe('the fail-safes, when the disk will not cooperate', () => {
  it('a blank account id is refused by both claim paths', () => {
    fresh();
    expect(claimDefaultRoot(home, '   ')).toEqual({ kind: 'unreadable' });
    expect(adoptDefaultRootAsIncumbent(home, '  ')).toEqual({ kind: 'unreadable' });
    expect(readAccountClaim(home)).toEqual({ kind: 'unclaimed' });
  });

  it('an unusable id cannot be adopted, even by the dialog', () => {
    upgraded();
    expect(() => adoptDefaultRootAsIncumbent(home, '../escape')).toThrow(/unexpected account id/);
  });

  it('the observation does not throw when it cannot be written', () => {
    // A file where the home directory belongs. Losing the observation is
    // survivable — it reads as "had data", which asks rather than assumes.
    const blocked = path.join(home, 'blocked');
    fs.writeFileSync(blocked, 'not a directory', 'utf-8');
    expect(() => observePreExistingData(path.join(blocked, 'home'))).not.toThrow();
    expect(hadPreExistingData(path.join(blocked, 'home'))).toBe(true);
  });

  it('the sweep does not throw when a root cannot be removed', () => {
    makeAccountRoot('_unresolved-deadbeef');
    fs.chmodSync(path.join(home, 'accounts'), 0o500);
    try {
      expect(() => sweepStaleQuarantineRoots(home)).not.toThrow();
    } finally {
      fs.chmodSync(path.join(home, 'accounts'), 0o700);
    }
  });

  it('recording the ownership choice does not throw when it cannot be written', () => {
    fs.writeFileSync(path.join(home, 'accounts'), 'not a directory', 'utf-8');
    expect(() => declineDefaultRoot(home, B)).not.toThrow();
  });

  it('the synchronous record write is the same shape as the async one', () => {
    writeActiveAccountSync(home, A);
    expect(readActiveAccount(home)).toEqual(signedIn(A));
    writeActiveAccountSync(home, null);
    expect(readActiveAccount(home)).toEqual(signedOut(A));
  });

  it('a quarantined session still gets a usable environment', () => {
    // It says so in the log, but it must not fail to start.
    upgraded();
    makeAccountRoot(A);
    const env = sidecarEnvForSession(home, NEVER);
    expect(env.COWORK_HOME).toMatch(/_unresolved-/);
  });
});

describe('a record write that cannot land', () => {
  // A directory where the record file belongs, so the rename cannot succeed.
  const blockTheRename = () => fs.mkdirSync(path.join(home, 'active-account.json'));
  const strayTemps = () =>
    fs.readdirSync(home).filter((n) => n.startsWith('active-account.json.tmp-'));

  it('surfaces, and leaves no temp file holding a half-written record', async () => {
    blockTheRename();
    await expect(writeActiveAccount(home, A)).rejects.toThrow();
    expect(strayTemps()).toEqual([]);
  });

  it('does the same synchronously', () => {
    blockTheRename();
    expect(() => writeActiveAccountSync(home, A)).toThrow();
    expect(strayTemps()).toEqual([]);
  });
});

describe('records that were hand-edited or written by an older build', () => {
  const write = (name: string, value: unknown) =>
    fs.writeFileSync(path.join(home, name), JSON.stringify(value), 'utf-8');

  it('a non-string account id reads as never-signed-in, not as an id', () => {
    write('active-account.json', { accountId: 42 });
    expect(readActiveAccount(home)).toEqual(NEVER);
  });

  it('a non-string last account reads as signed out with none', () => {
    write('active-account.json', { accountId: null, lastAccountId: 42 });
    expect(readActiveAccount(home)).toEqual(signedOut(null));
  });

  it('a non-string claim id reads as unreadable, never as free', () => {
    write('.account', { accountId: 42 });
    expect(readAccountClaim(home)).toEqual({ kind: 'unreadable' });
  });

  it('a non-boolean observation reads as "had data"', () => {
    // Anything but an explicit false keeps an account off a root we cannot
    // vouch for, which is the safe direction.
    write('.pre-existing-data', { hadData: 'yes' });
    expect(hadPreExistingData(home)).toBe(true);
    write('.pre-existing-data', {});
    expect(hadPreExistingData(home)).toBe(true);
  });

  it('an explicit false is the only thing that means "fresh"', () => {
    write('.pre-existing-data', { hadData: false });
    expect(hadPreExistingData(home)).toBe(false);
  });
});
