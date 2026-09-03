import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// These decide which account keeps the pre-existing data root, so the cases that
// matter are the adversarial ones: a second account must never take a claimed
// root, and a claim or active-account record that is corrupt or unwritable must
// fail closed (nobody adopts) rather than open (the next signer-in adopts).
import {
  accountOwnerToken,
  adoptDefaultRootAsIncumbent,
  claimDefaultRoot,
  readAccountClaim,
  readActiveAccount,
  reconcileAccountRoot,
  resolveAccountRoot,
  sidecarEnvForSession,
  writeActiveAccount,
} from './account-data';

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';

const signedIn = (accountId: string) => ({ kind: 'signed-in' as const, accountId });
const signedOut = (lastAccountId: string | null = null) => ({
  kind: 'signed-out' as const,
  lastAccountId,
});
// An install with data already on the default root, as every install that
// upgrades into per-account roots has.
const withData = () => fs.writeFileSync(path.join(home, 'cowork.db'), 'x', 'utf-8');
const UNKNOWN = { kind: 'unknown' as const };

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-account-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('readAccountClaim', () => {
  it('reports an unclaimed root', () => {
    expect(readAccountClaim(home)).toEqual({ kind: 'unclaimed' });
  });

  it('reports a corrupt claim as unreadable, not as free', () => {
    fs.writeFileSync(path.join(home, '.account'), 'not json', 'utf-8');
    expect(readAccountClaim(home)).toEqual({ kind: 'unreadable' });
  });

  it('treats a claim with no account id as unreadable', () => {
    fs.writeFileSync(path.join(home, '.account'), JSON.stringify({ accountId: '  ' }), 'utf-8');
    expect(readAccountClaim(home)).toEqual({ kind: 'unreadable' });
  });
});

describe('claimDefaultRoot', () => {
  it('claims a free root and reads back the same owner', () => {
    expect(claimDefaultRoot(home, ACCOUNT_A)).toEqual({ kind: 'claimed', accountId: ACCOUNT_A });
    expect(readAccountClaim(home)).toEqual({ kind: 'claimed', accountId: ACCOUNT_A });
  });

  it('is idempotent for the account that already owns the root', () => {
    claimDefaultRoot(home, ACCOUNT_A);
    expect(claimDefaultRoot(home, ACCOUNT_A)).toEqual({ kind: 'claimed', accountId: ACCOUNT_A });
  });

  it('never lets a second account steal a claimed root', () => {
    claimDefaultRoot(home, ACCOUNT_A);
    expect(claimDefaultRoot(home, ACCOUNT_B)).toEqual({ kind: 'claimed', accountId: ACCOUNT_A });
    expect(readAccountClaim(home)).toEqual({ kind: 'claimed', accountId: ACCOUNT_A });
  });

  it('creates the root when it does not exist yet', () => {
    const fresh = path.join(home, 'accounts', ACCOUNT_B);
    expect(claimDefaultRoot(fresh, ACCOUNT_B)).toEqual({ kind: 'claimed', accountId: ACCOUNT_B });
    expect(fs.existsSync(path.join(fresh, '.account'))).toBe(true);
  });

  it('refuses a blank account id', () => {
    expect(claimDefaultRoot(home, '   ')).toEqual({ kind: 'unreadable' });
    expect(readAccountClaim(home)).toEqual({ kind: 'unclaimed' });
  });

  it('fails closed when the claim cannot be written', () => {
    // A directory where the claim file belongs, so the create cannot succeed.
    // That must not read as "free to adopt".
    fs.mkdirSync(path.join(home, '.account'));
    expect(claimDefaultRoot(home, ACCOUNT_A)).toEqual({ kind: 'unreadable' });
  });
});

describe('the active account on disk', () => {
  it('round-trips a signed-in account', async () => {
    expect(readActiveAccount(home)).toEqual(UNKNOWN);
    await writeActiveAccount(home, ACCOUNT_A);
    expect(readActiveAccount(home)).toEqual(signedIn(ACCOUNT_A));
    await writeActiveAccount(home, ACCOUNT_B);
    expect(readActiveAccount(home)).toEqual(signedIn(ACCOUNT_B));
  });

  it('records a sign-out rather than deleting the record', async () => {
    // The distinction is load-bearing: a missing record has to stay
    // distinguishable from a deliberate sign-out.
    await writeActiveAccount(home, ACCOUNT_A);
    await writeActiveAccount(home, null);
    // And it KEEPS the account, so the install stays on the root it was using.
    expect(readActiveAccount(home)).toEqual(signedOut(ACCOUNT_A));
  });

  it('reads a corrupt record as unknown rather than as an id', () => {
    fs.writeFileSync(path.join(home, 'active-account.json'), '{ broken', 'utf-8');
    expect(readActiveAccount(home)).toEqual(UNKNOWN);
  });

  it('refuses to record an unsafe id', async () => {
    await expect(writeActiveAccount(home, '../escape')).rejects.toThrow(/unexpected account id/);
  });
});

describe('resolveAccountRoot', () => {
  it('leaves the owning account on the default root', () => {
    claimDefaultRoot(home, ACCOUNT_A);
    expect(resolveAccountRoot(home, signedIn(ACCOUNT_A))).toBeNull();
  });

  it('sends a second account to its own root', () => {
    claimDefaultRoot(home, ACCOUNT_A);
    expect(resolveAccountRoot(home, signedIn(ACCOUNT_B))).toBe(ACCOUNT_B);
  });

  it('leaves an EMPTY unclaimed root alone, so a fresh install adopts it', () => {
    expect(resolveAccountRoot(home, signedIn(ACCOUNT_A))).toBeNull();
    expect(resolveAccountRoot(home, UNKNOWN)).toBeNull();
  });

  it('keeps an account OFF an unclaimed root that already holds data', () => {
    // This is the upgrade case and the reported bug: an install that upgraded
    // while signed in has data and no claim, so whoever asks first must not get
    // it. Only the boot reconcile may hand it to the incumbent.
    withData();
    expect(resolveAccountRoot(home, signedIn(ACCOUNT_B))).toBe(ACCOUNT_B);
    expect(resolveAccountRoot(home, UNKNOWN)).toMatch(/^_unresolved-/);
  });

  it('sends an account to its own root when the claim is unreadable', () => {
    fs.writeFileSync(path.join(home, '.account'), 'corrupt', 'utf-8');
    expect(resolveAccountRoot(home, signedIn(ACCOUNT_A))).toBe(ACCOUNT_A);
  });

  it('quarantines an unknown session when someone owns the default root', () => {
    claimDefaultRoot(home, ACCOUNT_A);
    // Per process, not one shared bucket: two unresolvable sessions must not be
    // able to read each other's work either.
    expect(resolveAccountRoot(home, UNKNOWN)).toMatch(/^_unresolved-/);
  });

  it('keeps a signed-out non-owner on its own root, not the owner root', () => {
    // Sign-out used to drop straight back to the default root, which for a
    // non-owning account means the OWNER's database.
    claimDefaultRoot(home, ACCOUNT_A);
    expect(resolveAccountRoot(home, signedOut(ACCOUNT_B))).toBe(ACCOUNT_B);
  });

  it('keeps a signed-out owner on the default root', () => {
    claimDefaultRoot(home, ACCOUNT_A);
    expect(resolveAccountRoot(home, signedOut(ACCOUNT_A))).toBeNull();
  });

  it('writes nothing, so the probe and spawn paths agree', () => {
    const before = fs.readdirSync(home);
    resolveAccountRoot(home, signedIn(ACCOUNT_A));
    resolveAccountRoot(home, UNKNOWN);
    expect(fs.readdirSync(home)).toEqual(before);
  });

  it('refuses an account id that is not a safe path segment', () => {
    expect(() => resolveAccountRoot(home, signedIn('../escape'))).toThrow(/unexpected account id/);
  });
});

describe('sidecarEnvForSession', () => {
  it('adds nothing for a signed-out app or the owning account', () => {
    claimDefaultRoot(home, ACCOUNT_A);
    // The signed-out OWNER, which is the single-account desktop: still its data.
    expect(sidecarEnvForSession(home, signedOut(ACCOUNT_A))).toEqual({});
    expect(sidecarEnvForSession(home, signedIn(ACCOUNT_A))).toEqual({});
  });

  it('gives a second account its own subtree for every store', () => {
    claimDefaultRoot(home, ACCOUNT_A);
    const env = sidecarEnvForSession(home, signedIn(ACCOUNT_B));
    const root = path.join(home, 'accounts', ACCOUNT_B);

    expect(env).toEqual({
      COWORK_ACCOUNT_ID: ACCOUNT_B,
      DATABASE_URI: `sqlite:///${path.join(root, 'cowork.db')}`,
      COWORK_PROJECTS_DIR: path.join(root, 'projects'),
      COWORK_FILES_DIR: path.join(root, 'files'),
      COWORK_MEMORY_DIR: path.join(root, 'memory'),
      COWORK_VAULT_DIR: path.join(root, 'data-vault'),
      COWORK_STREAMS_DIR: path.join(root, 'streams'),
      COWORK_CODING_DIR: path.join(root, 'coding'),
      HERMES_ROOT_DIR: path.join(root, 'hermes'),
      ANTON_COWORK_STATE_DIR: path.join(root, 'publish'),
      COWORK_SKILLS_DIR: path.join(root, 'skills'),
      ANTON_SKILLS_ROOT_DIR: path.join(root, 'anton', 'skills'),
      COWORK_OAUTH_STATE_PATH: path.join(root, 'oauth_state.json'),
    });
    // Nothing in B's environment may point back at the shared root. The DB value
    // is a DSN, so compare the path it carries rather than the whole string.
    for (const [name, value] of Object.entries(env)) {
      if (name === 'COWORK_ACCOUNT_ID') continue;
      expect(value.replace(/^sqlite:\/\/\//, '').startsWith(root)).toBe(true);
    }
  });

  it('quarantines an unknown session on a claimed root', () => {
    claimDefaultRoot(home, ACCOUNT_A);
    const env = sidecarEnvForSession(home, UNKNOWN);
    expect(env.COWORK_ACCOUNT_ID).toMatch(/^_unresolved-/);
    expect(env.DATABASE_URI).toContain(path.join('accounts', '_unresolved'));
  });
});

describe('accountOwnerToken', () => {
  const SECRET = 'a-server-owner-secret';

  it('is the secret itself when there is no account', () => {
    // Keeps the signed-out and default-root cases on exactly today's token.
    expect(accountOwnerToken(SECRET, null)).toBe(SECRET);
  });

  it('differs per account so one account cannot adopt another server', () => {
    const a = accountOwnerToken(SECRET, ACCOUNT_A);
    const b = accountOwnerToken(SECRET, ACCOUNT_B);
    expect(a).not.toBe(b);
    expect(a).not.toBe(SECRET);
    expect(accountOwnerToken(SECRET, ACCOUNT_A)).toBe(a);
  });

  it('does not expose the secret it was derived from', () => {
    expect(accountOwnerToken(SECRET, ACCOUNT_A)).not.toContain(SECRET);
  });
});


describe('claiming a populated root', () => {
  it('refuses a sign-in on an unclaimed root that already holds data', () => {
    withData();
    expect(claimDefaultRoot(home, ACCOUNT_B)).toEqual({ kind: 'unclaimed' });
    expect(fs.existsSync(path.join(home, '.account'))).toBe(false);
  });

  it('lets the incumbent adopt it, which is the upgrade path', () => {
    withData();
    expect(adoptDefaultRootAsIncumbent(home, ACCOUNT_A))
      .toEqual({ kind: 'claimed', accountId: ACCOUNT_A });
    expect(resolveAccountRoot(home, signedIn(ACCOUNT_A))).toBeNull();
  });

  it('still lets a fresh install claim an empty root at sign-in', () => {
    expect(claimDefaultRoot(home, ACCOUNT_A))
      .toEqual({ kind: 'claimed', accountId: ACCOUNT_A });
  });
});

describe('reconcileAccountRoot', () => {
  it('gives an upgraded install its data back and locks others out', async () => {
    // The whole reported bug, end to end: A upgraded with data and no claim, so
    // A must keep it and B must not be able to take it.
    withData();
    await reconcileAccountRoot(home, ACCOUNT_A);

    expect(readActiveAccount(home)).toEqual(signedIn(ACCOUNT_A));
    expect(resolveAccountRoot(home, signedIn(ACCOUNT_A))).toBeNull();
    expect(claimDefaultRoot(home, ACCOUNT_B)).toEqual({ kind: 'claimed', accountId: ACCOUNT_A });
    expect(resolveAccountRoot(home, signedIn(ACCOUNT_B))).toBe(ACCOUNT_B);
  });

  it('does nothing without an account to reconcile', async () => {
    withData();
    await reconcileAccountRoot(home, null);
    expect(readActiveAccount(home)).toEqual(UNKNOWN);
    expect(readAccountClaim(home)).toEqual({ kind: 'unclaimed' });
  });

  it('is idempotent once settled', async () => {
    await reconcileAccountRoot(home, ACCOUNT_A);
    await reconcileAccountRoot(home, ACCOUNT_A);
    expect(readAccountClaim(home)).toEqual({ kind: 'claimed', accountId: ACCOUNT_A });
  });

  it('repairs a record that names an account with no claim yet', async () => {
    // A sign-in whose finalize bailed before claiming leaves exactly this.
    await writeActiveAccount(home, ACCOUNT_A);
    withData();
    await reconcileAccountRoot(home, ACCOUNT_A);
    expect(readAccountClaim(home)).toEqual({ kind: 'claimed', accountId: ACCOUNT_A });
  });
});
