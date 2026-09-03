import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The claim decides which account keeps the pre-existing default data root, so
// the cases that matter are the adversarial ones: a second account must never
// take a claimed root, and a claim that is corrupt or unwritable must fail
// closed (nobody adopts) rather than open (the next signer-in adopts).
import { claimDefaultRoot, readAccountClaim, sidecarEnvForAccount } from './account-data';

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';

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
    // The file still names A, so B cannot have overwritten it.
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
    // A directory where the claim file belongs: the create fails with EISDIR,
    // which must not read as "free to adopt".
    fs.mkdirSync(path.join(home, '.account'));
    expect(claimDefaultRoot(home, ACCOUNT_A)).toEqual({ kind: 'unreadable' });
  });
});

describe('sidecarEnvForAccount', () => {
  it('adds nothing when signed out, so the sidecar keeps today environment', () => {
    expect(sidecarEnvForAccount(home, null)).toEqual({});
    expect(sidecarEnvForAccount(home, '  ')).toEqual({});
  });

  it('adds nothing for the account that owns the default root', () => {
    // The upgrade path: an existing single-account install claims what it has
    // and must keep reading exactly the same stores.
    expect(sidecarEnvForAccount(home, ACCOUNT_A)).toEqual({});
    expect(readAccountClaim(home)).toEqual({ kind: 'claimed', accountId: ACCOUNT_A });
    // Still nothing on the next launch, now that the claim exists.
    expect(sidecarEnvForAccount(home, ACCOUNT_A)).toEqual({});
  });

  it('gives a second account its own subtree for every store', () => {
    sidecarEnvForAccount(home, ACCOUNT_A);
    const env = sidecarEnvForAccount(home, ACCOUNT_B);
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
    });
    // Nothing in B's environment may point back at the shared root. The DB value
    // is a DSN, so compare the path it carries rather than the whole string.
    for (const [name, value] of Object.entries(env)) {
      if (name === 'COWORK_ACCOUNT_ID') continue;
      expect(value.replace(/^sqlite:\/\/\//, '').startsWith(root)).toBe(true);
    }
  });

  it('sends an account to its own root when the claim is unreadable', () => {
    fs.writeFileSync(path.join(home, '.account'), 'corrupt', 'utf-8');
    const env = sidecarEnvForAccount(home, ACCOUNT_A);
    expect(env.COWORK_ACCOUNT_ID).toBe(ACCOUNT_A);
    expect(env.DATABASE_URI).toContain(path.join('accounts', ACCOUNT_A));
  });

  it('refuses an account id that is not a safe path segment', () => {
    expect(() => sidecarEnvForAccount(home, '../escape')).toThrow(/unexpected account id/);
    // It must not have claimed the shared root on the way out.
    expect(readAccountClaim(home)).toEqual({ kind: 'unclaimed' });
  });
});
