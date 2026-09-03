// Which data root the sidecar is given for the signed-in account.
//
// One machine and one OS user can host several MindsHub accounts, and every
// sidecar store hangs off a single root, so without this each account sees the
// previous account's tasks, files, connector credentials and agent memory. The
// first account to sign in CLAIMS the default root, which is what keeps an
// existing single-account install working: its history stays where it is and no
// data is ever moved. Every later account gets its own subtree beside it.
//
// The claim is an exclusive file create, and that is what makes it safe. The
// filesystem picks the winner, a second account cannot overwrite an existing
// claim, and a claim that cannot be written or read resolves to "not adopted"
// rather than handing the default root to whoever signed in next.

import * as fs from 'fs';
import * as path from 'path';

// Deliberately inside the root it claims, not in state.json: cowork-server
// read-modify-writes that same file, so a lost claim there would leak the root.
const CLAIM_FILE = '.account';

export type ClaimState =
  | { kind: 'unclaimed' }
  | { kind: 'claimed'; accountId: string }
  | { kind: 'unreadable' };

function claimPath(home: string): string {
  return path.join(home, CLAIM_FILE);
}

/**
 * Who owns `home`. `unreadable` is distinct from `unclaimed` on purpose: a
 * corrupt or unreadable claim must never be treated as free, or the next
 * account to sign in would adopt a root that already holds someone's data.
 */
export function readAccountClaim(home: string): ClaimState {
  let raw: string;
  try {
    raw = fs.readFileSync(claimPath(home), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'unclaimed' };
    return { kind: 'unreadable' };
  }
  try {
    const parsed = JSON.parse(raw) as { accountId?: unknown };
    const accountId = typeof parsed?.accountId === 'string' ? parsed.accountId.trim() : '';
    if (!accountId) return { kind: 'unreadable' };
    return { kind: 'claimed', accountId };
  } catch {
    return { kind: 'unreadable' };
  }
}

/**
 * Try to make `accountId` the owner of `home`, and report who owns it
 * afterwards. Idempotent: re-claiming for the same account returns `claimed`
 * for it. Never steals — an existing claim by another account is returned
 * unchanged, and any write failure returns `unreadable` so the caller falls
 * back to a per-account root instead of sharing this one.
 */
export function claimDefaultRoot(home: string, accountId: string): ClaimState {
  const trimmed = accountId.trim();
  if (!trimmed) return { kind: 'unreadable' };

  try {
    fs.mkdirSync(home, { recursive: true });
    // wx: an exclusive create IS the claim, so two accounts racing here cannot
    // both win and neither can clobber a claim that already exists.
    fs.writeFileSync(claimPath(home), JSON.stringify({ accountId: trimmed }) + '\n', {
      encoding: 'utf-8',
      mode: 0o600,
      flag: 'wx',
    });
    return { kind: 'claimed', accountId: trimmed };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return { kind: 'unreadable' };
  }
  return readAccountClaim(home);
}
