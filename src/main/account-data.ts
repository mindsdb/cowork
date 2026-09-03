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

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { retryOnTransientLock } from './fs-retry';

// Deliberately inside the root it claims, not in state.json: cowork-server
// read-modify-writes that same file, so a lost claim there would leak the root.
const CLAIM_FILE = '.account';

// Which account the app is signed in as. Its own file rather than state.json,
// for the same reason as the claim above.
const ACTIVE_FILE = 'active-account.json';

// Per-account roots live under here, one subdirectory per account.
export const ACCOUNTS_DIR = 'accounts';

// Where a signed-in session with an unresolvable account goes. Not a real
// account id, just a root nobody else uses, so nothing leaks while it is used.
export const QUARANTINE_ACCOUNT = '_unresolved';

export type ClaimState =
  | { kind: 'unclaimed' }
  | { kind: 'claimed'; accountId: string }
  | { kind: 'unreadable' };

// Sign-out is recorded rather than implied by a missing file, so that "nobody is
// signed in" (keep today's default root) stays distinguishable from "the record
// is gone" (fail closed). Without that distinction both look the same and one of
// them has to be guessed wrong.
export type ActiveAccount =
  | { kind: 'signed-in'; accountId: string }
  | { kind: 'signed-out' }
  | { kind: 'unknown' };

// A Keycloak `sub` is a UUID; this only has to be a safe single path segment.
const SAFE_ACCOUNT_ID = /^[A-Za-z0-9._-]{1,128}$/;

function assertUsableAsPathSegment(accountId: string): void {
  if (!SAFE_ACCOUNT_ID.test(accountId) || accountId === '.' || accountId === '..') {
    // Refusing beats falling back to the shared root, which would be the leak.
    throw new Error('[account-data] refusing to derive a data root from an unexpected account id');
  }
}

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

/** The account the app is signed in as. */
export function readActiveAccount(home: string): ActiveAccount {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(home, ACTIVE_FILE), 'utf-8');
  } catch (err) {
    // Absent is `unknown`, not `signed-out`: on a pre-existing install nobody
    // has written it yet, and a lost file must not read as a deliberate state.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'unknown' };
    return { kind: 'unknown' };
  }
  try {
    const parsed = JSON.parse(raw) as { accountId?: unknown };
    if (parsed?.accountId === null) return { kind: 'signed-out' };
    const accountId = typeof parsed?.accountId === 'string' ? parsed.accountId.trim() : '';
    return accountId ? { kind: 'signed-in', accountId } : { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}

/**
 * Record who is signed in, or `null` for a deliberate sign-out. Atomic, so a
 * torn write cannot leave a half-parsed id that resolves to the wrong root, and
 * it must land BEFORE the sidecar is started for that account.
 */
export async function writeActiveAccount(home: string, accountId: string | null): Promise<void> {
  const trimmed = accountId === null ? null : accountId.trim();
  if (trimmed !== null) assertUsableAsPathSegment(trimmed);
  fs.mkdirSync(home, { recursive: true });
  const target = path.join(home, ACTIVE_FILE);
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify({ accountId: trimmed }) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  try {
    await retryOnTransientLock(() => fs.renameSync(tmp, target));
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

/**
 * Which account's stores this session should use, as a pure read: null means the
 * default root and therefore no environment overrides at all.
 *
 * Read-only on purpose. The claim is written at sign-in instead, so that the
 * probe paths deciding whether to adopt a running server reach the same answer
 * as the spawn path without ever creating a claim as a side effect.
 */
export function resolveAccountRoot(home: string, active: ActiveAccount): string | null {
  if (active.kind === 'signed-out') return null;

  if (active.kind === 'unknown') {
    // Nobody has claimed the default root, so this is a fresh or pre-existing
    // install rather than a lost record: leave it exactly as it is today.
    if (readAccountClaim(home).kind === 'unclaimed') return null;
    // Someone owns it and we cannot prove it is us. Handing it over is the
    // reported bug, so take an empty root until the next sign-in resolves this.
    return QUARANTINE_ACCOUNT;
  }

  assertUsableAsPathSegment(active.accountId);
  const claim = readAccountClaim(home);
  if (claim.kind === 'unclaimed') return null;
  if (claim.kind === 'claimed' && claim.accountId === active.accountId) return null;
  return active.accountId;
}

/**
 * The store paths the sidecar gets for `root`, mirroring cowork-server's own
 * defaults so the layout beside a claimed root reads the same. COWORK_ACCOUNT_ID
 * is what tells the server it is NOT on the shared root, so it skips the
 * one-time `.env` and memory seeds that would otherwise import the previous
 * account's keys and profile.
 */
export function accountStoreEnv(root: string, accountId: string): Record<string, string> {
  const at = (name: string) => path.join(root, name);
  return {
    COWORK_ACCOUNT_ID: accountId,
    DATABASE_URI: `sqlite:///${at('cowork.db')}`,
    COWORK_PROJECTS_DIR: at('projects'),
    COWORK_FILES_DIR: at('files'),
    COWORK_MEMORY_DIR: at('memory'),
    COWORK_VAULT_DIR: at('data-vault'),
    COWORK_STREAMS_DIR: at('streams'),
    COWORK_CODING_DIR: at('coding'),
    HERMES_ROOT_DIR: at('hermes'),
    ANTON_COWORK_STATE_DIR: at('publish'),
  };
}

/**
 * The environment additions for the session the sidecar is about to serve.
 * Empty for a signed-out app and for the account that owns the default root, so
 * both keep byte-for-byte the environment they have today.
 */
export function sidecarEnvForSession(home: string, active: ActiveAccount): Record<string, string> {
  const account = resolveAccountRoot(home, active);
  if (account === null) return {};
  return accountStoreEnv(path.join(home, ACCOUNTS_DIR, account), account);
}

/**
 * Bind a server-owner secret to an account.
 *
 * Server adoption matches on this value, and the secret alone is one value per
 * OS user per build — so without the account in it, an orphan sidecar still
 * holding the PREVIOUS account's database matches and gets adopted, which hands
 * the new account that account's tasks. HMAC so the secret is never exposed by
 * the value we publish at /health, and the secret unchanged when there is no
 * account, so signed-out and default-root installs keep today's token exactly.
 */
export function accountOwnerToken(secret: string, accountId: string | null): string {
  if (!accountId) return secret;
  return crypto.createHmac('sha256', secret).update(accountId).digest('hex');
}
