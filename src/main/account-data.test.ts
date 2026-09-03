import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The claim decides which account keeps the pre-existing default data root, so
// the cases that matter are the adversarial ones: a second account must never
// take a claimed root, and a claim that is corrupt or unwritable must fail
// closed (nobody adopts) rather than open (the next signer-in adopts).
import { claimDefaultRoot, readAccountClaim } from './account-data';

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
