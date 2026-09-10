import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// This module decides which account's data a session reads, so the whole
// resolution table is enumerated below rather than sampled. Two cells carry the
// design and are called out where they appear: an account must never take data
// it cannot prove is its own, and a session that cannot name itself must not be
// sent away from data that already was.
import {
  accountDataHome,
  accountOwnerToken,
  adoptDefaultRootAsIncumbent,
  claimDefaultRoot,
  clearActiveAccountRecord,
  claimForRecordedIncumbent,
  hadPreExistingData,
  isOwnershipSettled,
  knownAccountRoots,
  needsOwnershipDecision,
  observePreExistingData,
  recordedIncumbent,
  settleOwnership,
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

  // The database alone was too narrow. An install whose onboarding stored
  // provider keys but whose sidecar never started successfully has none, so it
  // recorded as empty and the first account to sign in would have claimed it
  // and inherited the keys and the connector vault with nobody asked.
  it('records true for provider keys in the dotenv and no database', () => {
    fs.writeFileSync(
      path.join(home, '.env'),
      'ANTON_TERMS_CONSENT=1\nANTON_ANTHROPIC_API_KEY=sk-not-a-real-key\n',
      'utf-8',
    );
    observePreExistingData(home);
    expect(hadPreExistingData(home)).toBe(true);
  });

  it('records true for a connector vault and no database', () => {
    fs.mkdirSync(path.join(home, 'data-vault'), { recursive: true });
    fs.writeFileSync(path.join(home, 'data-vault', 'postgres.json'), '{}', 'utf-8');
    observePreExistingData(home);
    expect(hadPreExistingData(home)).toBe(true);
  });

  it('records true for a provider state file and no database', () => {
    fs.writeFileSync(path.join(home, 'state.json'), '{"preferences":{}}', 'utf-8');
    observePreExistingData(home);
    expect(hadPreExistingData(home)).toBe(true);
  });

  it('records true for user files and no database', () => {
    fs.mkdirSync(path.join(home, 'projects', 'a-project'), { recursive: true });
    observePreExistingData(home);
    expect(hadPreExistingData(home)).toBe(true);
  });

  // The other half of the rule, and the reason none of the above is a bare
  // existence check: an install that only ever reached the sign-in screen has a
  // dotenv holding a generated auth token and consent flag, and the store
  // directories the sidecar mkdirs at startup. Counting those would ask a
  // brand-new user whose data theirs is.
  it('records false for an install that only ever reached the sign-in screen', () => {
    fs.writeFileSync(
      path.join(home, '.env'),
      '# generated\nCOWORK_AUTH_TOKEN=generated-at-first-start\nANTON_TERMS_CONSENT=1\n',
      'utf-8',
    );
    for (const dir of ['projects', 'files', 'memory', 'skills', 'data-vault']) {
      fs.mkdirSync(path.join(home, dir), { recursive: true });
    }
    observePreExistingData(home);
    expect(hadPreExistingData(home)).toBe(false);
  });

  it('records false for a credential key present but empty', () => {
    fs.writeFileSync(path.join(home, '.env'), 'ANTON_ANTHROPIC_API_KEY=\n', 'utf-8');
    observePreExistingData(home);
    expect(hadPreExistingData(home)).toBe(false);
  });

  it('does not read a commented-out credential as data', () => {
    fs.writeFileSync(
      path.join(home, '.env'),
      '# ANTON_ANTHROPIC_API_KEY=sk-not-a-real-key\n',
      'utf-8',
    );
    observePreExistingData(home);
    expect(hadPreExistingData(home)).toBe(false);
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
    // A desktop on local provider keys that never signed in to MindsHub. There
    // is no second identity to leak to, so it stays where it always was.
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
    settleOwnership(home);
    expect(isOwnershipSettled(home)).toBe(true);
    expect(needsOwnershipDecision(home, signedIn(B))).toBe(false);
    expect(fs.existsSync(path.join(home, 'cowork.db'))).toBe(true);
  });

  it('is final for EVERY account once anyone has answered', async () => {
    // The hole this closes: the marker used to be per account, so after B
    // disclaimed the data A was still offered it — and so was any other account
    // that signed in afterwards. One person owns the data, so one answer
    // settles it.
    upgraded();
    settleOwnership(home);
    await writeActiveAccount(home, B);
    expect(needsOwnershipDecision(home, signedIn(B))).toBe(false);
    expect(needsOwnershipDecision(home, signedIn(A))).toBe(false);
  });

  it('is not asked at all when the surviving session named an incumbent', () => {
    // The common upgrade. Nobody is asked, because the account that was signed
    // in on the build that made the data is known.
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(home, A);

    expect(needsOwnershipDecision(home, signedIn(A))).toBe(false);
    expect(needsOwnershipDecision(home, signedIn(B))).toBe(false);
  });

  it('is not asked of a SECOND account even if the incumbent claim never landed', () => {
    // The claim is what everything else reads, so a failed write must not fall
    // back to offering the data to whoever signs in next.
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(home, A);
    expect(readAccountClaim(home)).toEqual({ kind: 'unclaimed' });

    expect(needsOwnershipDecision(home, signedIn(B))).toBe(false);
  });
});

describe('the recorded incumbent', () => {
  it('is the account the surviving session named, alongside the data', () => {
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(home, A);
    expect(recordedIncumbent(home)).toBe(A);
  });

  it('is not recorded on a fresh install, which has nothing to attribute', () => {
    observePreExistingData(home, A);
    expect(recordedIncumbent(home)).toBeNull();
    expect(hadPreExistingData(home)).toBe(false);
  });

  it('is not recorded when no session survived', () => {
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(home, null);
    expect(recordedIncumbent(home)).toBeNull();
    expect(hadPreExistingData(home)).toBe(true);
  });

  it('refuses an account id that is not usable as a path segment', () => {
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(home, '../../etc');
    expect(recordedIncumbent(home)).toBeNull();
  });

  it('reads as none when the observation was never made', () => {
    // No marker at all, so the read throws rather than parsing. None is the
    // safe answer: it means nobody is handed the root without being asked.
    expect(recordedIncumbent(home)).toBeNull();
  });

  it('reads as none when the record is not JSON', () => {
    fs.writeFileSync(path.join(home, '.pre-existing-data'), 'not json', 'utf-8');
    expect(recordedIncumbent(home)).toBeNull();
  });

  it('is observed once, so a later sign-in cannot become the incumbent', () => {
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(home, A);
    observePreExistingData(home, B);
    expect(recordedIncumbent(home)).toBe(A);
  });
});

describe('handing the root to its incumbent', () => {
  it('claims it for them, so every other account resolves to its own root', () => {
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(home, A);

    expect(claimForRecordedIncumbent(home)).toBe(A);

    expect(readAccountClaim(home)).toEqual({ kind: 'claimed', accountId: A });
    expect(resolveAccountRoot(home, signedIn(A))).toBeNull();
    expect(resolveAccountRoot(home, signedIn(B))).toBe(B);
  });

  it('takes a root the ordinary sign-in path is forbidden to claim', () => {
    // claimDefaultRoot refuses data it cannot attribute, on purpose. The
    // incumbent record is the attribution, which is why this bypasses it.
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(home, A);
    expect(claimDefaultRoot(home, A)).toEqual({ kind: 'unclaimed' });

    expect(claimForRecordedIncumbent(home)).toBe(A);
  });

  it('does nothing when no incumbent was recorded', () => {
    upgraded();
    expect(claimForRecordedIncumbent(home)).toBeNull();
    expect(readAccountClaim(home)).toEqual({ kind: 'unclaimed' });
  });

  it('never overrides a claim that already exists', () => {
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(home, A);
    adoptDefaultRootAsIncumbent(home, B); // the person answered first

    expect(claimForRecordedIncumbent(home)).toBe(B);
    expect(readAccountClaim(home)).toEqual({ kind: 'claimed', accountId: B });
  });

  it('serves the incumbent its own data on an OFFLINE launch', () => {
    // The regression this guards: the claim lands at boot, but the account
    // record needs a token refresh to succeed. With no network there is no
    // record, so the session cannot name itself, and quarantining that would
    // show the install's only user an empty app on every offline launch.
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(home, A);
    claimForRecordedIncumbent(home);

    expect(readActiveAccount(home)).toEqual(NEVER);
    expect(resolveAccountRoot(home, NEVER)).toBeNull();
    expect(resolveAccountRoot(home, signedOut(null))).toBeNull();
  });

  it('still quarantines a nameless session when the claim is somebody ELSE\'s', () => {
    // No incumbent was recorded, so the claim came from the dialog. That
    // account has to sign in to reach its data; a session that cannot name
    // itself is not it.
    upgraded();
    adoptDefaultRootAsIncumbent(home, B);

    expect(resolveAccountRoot(home, NEVER)).toMatch(/^_unresolved-/);
  });

  it('reports nothing, and does not throw, when the claim cannot be written', () => {
    // The guard behind the boot call: a claim that cannot land must leave the
    // root unowned rather than half-owned, and needsOwnershipDecision then
    // keeps a SECOND account from being offered it.
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(home, A);
    fs.chmodSync(home, 0o500); // readable, not writable
    try {
      expect(claimForRecordedIncumbent(home)).toBeNull();
      expect(needsOwnershipDecision(home, signedIn(B))).toBe(false);
    } finally {
      fs.chmodSync(home, 0o700);
    }
  });

  it('reports nothing when the claim cannot be read at all', () => {
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(home, A);
    // A directory where the claim file goes: readable as neither absent nor a
    // record, which is the 'unreadable' state.
    fs.mkdirSync(path.join(home, '.account'), { recursive: true });
    expect(readAccountClaim(home)).toEqual({ kind: 'unreadable' });
    expect(claimForRecordedIncumbent(home)).toBeNull();
  });

  it('is idempotent across boots', () => {
    fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
    observePreExistingData(home, A);
    expect(claimForRecordedIncumbent(home)).toBe(A);
    expect(claimForRecordedIncumbent(home)).toBe(A);
    expect(readAccountClaim(home)).toEqual({ kind: 'claimed', accountId: A });
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
    // A directory where the marker file goes. The write fails, and the path
    // still reads as settled, so the question stops rather than being offered
    // to the next account — the data is stranded, which is the safe direction.
    fs.mkdirSync(path.join(home, '.ownership-settled'), { recursive: true });
    expect(() => settleOwnership(home)).not.toThrow();
    expect(isOwnershipSettled(home)).toBe(true);
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

describe('a record that could not be written', () => {
  it('is removed, so the session cannot resolve onto the previous account', () => {
    // Leaving the previous account's name in place is worse than having no
    // record: every check downstream compares against the same stale value and
    // agrees, so the new account is served the old account's database.
    fresh();
    claimDefaultRoot(home, A);
    fs.writeFileSync(
      path.join(home, 'active-account.json'),
      JSON.stringify({ accountId: null, lastAccountId: A }),
      'utf-8',
    );
    expect(resolveAccountRoot(home, readActiveAccount(home))).toBeNull();

    clearActiveAccountRecord(home);

    expect(readActiveAccount(home)).toEqual(NEVER);
    expect(resolveAccountRoot(home, readActiveAccount(home))).toMatch(/^_unresolved-/);
  });

  it('is safe to clear when there is nothing to clear', () => {
    expect(() => clearActiveAccountRecord(home)).not.toThrow();
  });
});

describe('claiming leaves no temp file behind', () => {
  it('cleans up after itself', () => {
    fresh();
    claimDefaultRoot(home, A);
    expect(fs.readdirSync(home).filter((n) => n.startsWith('.account.tmp-'))).toEqual([]);
  });
});
