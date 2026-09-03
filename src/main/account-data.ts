// Which data root the sidecar is given for the signed-in account.
//
// One machine and one OS user can host several MindsHub accounts, and every
// sidecar store hangs off a single root, so without this each account sees the
// previous account's tasks, files, connector credentials, skills and agent
// memory. One account OWNS the default root — which is what keeps an existing
// single-account install working, since its data stays where it is and nothing
// is ever moved — and every other account gets its own subtree beside it.
//
// Ownership is an exclusive file create, and that is what makes it safe: the
// filesystem picks the winner and no account can overwrite another's claim.
// Everything that cannot be proven resolves AWAY from the default root rather
// than onto it, because the failure being guarded is precisely "this account is
// looking at someone else's data".

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { retryOnTransientLock } from './fs-retry';

// Deliberately inside the root it claims, not in state.json: cowork-server
// read-modify-writes that same file, so a lost claim there would leak the root.
const CLAIM_FILE = '.account';

// Which account the app is signed in as, and which it last was. Its own file
// rather than state.json, for the same reason as the claim above.
const ACTIVE_FILE = 'active-account.json';

// The database whose presence means "this root already holds someone's work".
const ROOT_DATA_MARKER = 'cowork.db';

// Per-account roots live under here, one subdirectory per account.
export const ACCOUNTS_DIR = 'accounts';

export type ClaimState =
  | { kind: 'unclaimed' }
  | { kind: 'claimed'; accountId: string }
  | { kind: 'unreadable' };

// Sign-out is recorded rather than implied by a missing file, and it keeps the
// account it was, so a signed-out install stays on the root it was actually
// using instead of falling back onto the owner's.
export type ActiveAccount =
  | { kind: 'signed-in'; accountId: string }
  | { kind: 'signed-out'; lastAccountId: string | null }
  | { kind: 'unknown' };

// A Keycloak `sub` is a UUID; this only has to be a safe single path segment.
const SAFE_ACCOUNT_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Where a session goes when the account cannot be named at all. Unique per
 * process: a single shared bucket would let one unresolvable session read
 * another's work, which is the same class of bug as the one being fixed.
 */
const QUARANTINE_ACCOUNT = `_unresolved-${crypto.randomBytes(4).toString('hex')}`;

function assertUsableAsPathSegment(accountId: string): void {
  if (!SAFE_ACCOUNT_ID.test(accountId) || accountId === '.' || accountId === '..') {
    // Refusing beats falling back to the shared root, which would be the leak.
    throw new Error('[account-data] refusing to derive a data root from an unexpected account id');
  }
}

function claimPath(home: string): string {
  return path.join(home, CLAIM_FILE);
}

/** Whether the default root already holds someone's work. */
export function defaultRootHasData(home: string): boolean {
  try {
    return fs.existsSync(path.join(home, ROOT_DATA_MARKER));
  } catch {
    // Unreadable: assume it does, so we resolve away from it rather than onto it.
    return true;
  }
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

function writeClaim(home: string, accountId: string): ClaimState {
  try {
    fs.mkdirSync(home, { recursive: true });
    // wx: an exclusive create IS the claim, so two accounts racing here cannot
    // both win and neither can clobber a claim that already exists.
    fs.writeFileSync(claimPath(home), JSON.stringify({ accountId }) + '\n', {
      encoding: 'utf-8',
      mode: 0o600,
      flag: 'wx',
    });
    return { kind: 'claimed', accountId };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return { kind: 'unreadable' };
  }
  return readAccountClaim(home);
}

/**
 * Claim the default root for an account signing in, and report who owns it
 * afterwards. Idempotent, and it never steals: an existing claim is returned
 * unchanged, and a write failure returns `unreadable` so the caller falls back
 * to a per-account root instead of sharing this one.
 *
 * It also refuses an unclaimed root that ALREADY HOLDS DATA. Nobody has proven
 * they own that data, so letting the next account to sign in take it is exactly
 * the reported bug — an install that upgraded while signed in has data and no
 * claim. Only `adoptDefaultRootAsIncumbent` may take a populated root.
 */
export function claimDefaultRoot(home: string, accountId: string): ClaimState {
  const trimmed = accountId.trim();
  if (!trimmed) return { kind: 'unreadable' };

  const existing = readAccountClaim(home);
  if (existing.kind === 'unclaimed' && defaultRootHasData(home)) return existing;
  return writeClaim(home, trimmed);
}

/**
 * Claim the default root for the account ALREADY signed in on this install,
 * including when it already holds data.
 *
 * This is the narrow, dangerous one and the only caller should be the boot
 * reconcile: at that point the session on disk is the one whose data this is,
 * because no other account can have signed in without going through
 * `claimDefaultRoot`, which refuses a populated root.
 */
export function adoptDefaultRootAsIncumbent(home: string, accountId: string): ClaimState {
  const trimmed = accountId.trim();
  if (!trimmed) return { kind: 'unreadable' };
  assertUsableAsPathSegment(trimmed);
  return writeClaim(home, trimmed);
}

/** The account the app is signed in as, and the one it last was. */
export function readActiveAccount(home: string): ActiveAccount {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(home, ACTIVE_FILE), 'utf-8');
  } catch {
    // Absent (a pre-existing install), unreadable, or gone. All three are
    // "cannot say", and each resolves away from the default root.
    return { kind: 'unknown' };
  }
  try {
    const parsed = JSON.parse(raw) as { accountId?: unknown; lastAccountId?: unknown };
    const last = typeof parsed?.lastAccountId === 'string' ? parsed.lastAccountId.trim() : '';
    if (parsed?.accountId === null) return { kind: 'signed-out', lastAccountId: last || null };
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
 *
 * A sign-out keeps the account it was signing out of, read from the record
 * rather than passed in, because the caller has usually cleared its tokens by
 * the time it gets here.
 */
export async function writeActiveAccount(home: string, accountId: string | null): Promise<void> {
  let record: { accountId: string | null; lastAccountId: string | null };
  if (accountId === null) {
    const current = readActiveAccount(home);
    const last =
      current.kind === 'signed-in' ? current.accountId
        : current.kind === 'signed-out' ? current.lastAccountId
          : null;
    record = { accountId: null, lastAccountId: last };
  } else {
    const trimmed = accountId.trim();
    assertUsableAsPathSegment(trimmed);
    record = { accountId: trimmed, lastAccountId: trimmed };
  }

  fs.mkdirSync(home, { recursive: true });
  const target = path.join(home, ACTIVE_FILE);
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify(record) + '\n', { encoding: 'utf-8', mode: 0o600 });
  try {
    await retryOnTransientLock(() => fs.renameSync(tmp, target));
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

/**
 * Make this install's data root belong to whoever is signed in, before anything
 * starts the sidecar.
 *
 * Without this, an install that upgraded into per-account roots while signed in
 * has data and no claim on it, and the next DIFFERENT account to sign in would
 * take it — the reported bug, on every existing install. It also repairs a
 * sign-in whose finalize bailed before recording anything.
 */
export async function reconcileAccountRoot(home: string, accountId: string | null): Promise<void> {
  if (!accountId) return;
  const active = readActiveAccount(home);
  const settled =
    active.kind === 'signed-in'
    && active.accountId === accountId
    && readAccountClaim(home).kind !== 'unclaimed';
  if (settled) return;
  await writeActiveAccount(home, accountId);
  adoptDefaultRootAsIncumbent(home, accountId);
}

/**
 * Which account's stores this session should use, as a pure read: null means the
 * default root and therefore no environment overrides at all.
 *
 * Read-only on purpose, so the probe paths deciding whether to adopt a running
 * server reach the same answer as the spawn path without creating a claim as a
 * side effect.
 */
export function resolveAccountRoot(home: string, active: ActiveAccount): string | null {
  const effective =
    active.kind === 'signed-in' ? active.accountId
      : active.kind === 'signed-out' ? active.lastAccountId
        : null;
  const claim = readAccountClaim(home);

  if (effective === null) {
    // Never signed in here, or the record is gone. An empty unclaimed root is a
    // fresh install; anything else may be someone's data, so stay off it.
    if (claim.kind === 'unclaimed' && !defaultRootHasData(home)) return null;
    return QUARANTINE_ACCOUNT;
  }

  assertUsableAsPathSegment(effective);
  if (claim.kind === 'claimed') return claim.accountId === effective ? null : effective;
  if (claim.kind === 'unclaimed') {
    // Data with no claim belongs to whoever the boot reconcile names, not to
    // whoever asks first.
    return defaultRootHasData(home) ? effective : null;
  }
  return effective;
}

/**
 * The store paths the sidecar gets for `root`, mirroring cowork-server's own
 * defaults so the layout beside a claimed root reads the same. COWORK_ACCOUNT_ID
 * is what tells the server it is NOT on the shared root, so it skips the
 * one-time `.env` and memory seeds that would otherwise import the previous
 * account's keys and profile.
 *
 * Every store cowork-server roots at COWORK_HOME belongs here. A server-side
 * test enumerates them, so adding one there fails that test rather than quietly
 * sharing it between accounts.
 */
export function accountStoreEnv(root: string, accountId: string): Record<string, string> {
  const at = (name: string) => path.join(root, name);
  return {
    COWORK_ACCOUNT_ID: accountId,
    DATABASE_URI: `sqlite:///${at(ROOT_DATA_MARKER)}`,
    COWORK_PROJECTS_DIR: at('projects'),
    COWORK_FILES_DIR: at('files'),
    COWORK_MEMORY_DIR: at('memory'),
    COWORK_VAULT_DIR: at('data-vault'),
    COWORK_STREAMS_DIR: at('streams'),
    COWORK_CODING_DIR: at('coding'),
    HERMES_ROOT_DIR: at('hermes'),
    ANTON_COWORK_STATE_DIR: at('publish'),
    // Skills are authored by the user, carry their full instructions, and are
    // listed straight off disk with no gate — and the server symlinks them into
    // every project directory, so a shared store also reaches the agent.
    COWORK_SKILLS_DIR: at('skills'),
    ANTON_SKILLS_ROOT_DIR: path.join(root, 'anton', 'skills'),
    // The vault below it is per-account, so the pending state has to be too, or
    // one account's in-flight authorization can complete into another's vault.
    COWORK_OAUTH_STATE_PATH: at('oauth_state.json'),
  };
}

/**
 * The environment additions for the session the sidecar is about to serve.
 * Empty for the account that owns the default root and for a fresh install, so
 * both keep byte-for-byte the environment they have today.
 */
export function sidecarEnvForSession(home: string, active: ActiveAccount): Record<string, string> {
  const account = resolveAccountRoot(home, active);
  if (account === null) return {};
  if (account === QUARANTINE_ACCOUNT) {
    console.warn(
      '[account-data] cannot name the signed-in account — starting on an empty root. '
      + 'Signing in again repairs this.',
    );
  }
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
 * account, so default-root installs keep today's token exactly.
 */
export function accountOwnerToken(secret: string, accountId: string | null): string {
  if (!accountId) return secret;
  return crypto.createHmac('sha256', secret).update(accountId).digest('hex');
}
