// Which data root the sidecar is given for the signed-in account.
//
// One machine and one OS user can host several MindsHub accounts, and every
// sidecar store hangs off a single root, so without this each account sees the
// previous account's tasks, files, connector credentials, skills and agent
// memory. One account OWNS the default root — which is what keeps an existing
// install working, since its data stays where it is and nothing is ever moved —
// and every other account gets its own subtree beside it.
//
// cowork-server derives everything from COWORK_HOME, so pointing that one
// variable at an account's root moves the database, every file store, the master
// key and the dotenv chain together. `test_cowork_home.py` pins that.
//
// Ownership is an exclusive file create: the filesystem picks the winner and no
// account can overwrite another's claim. Everything unproven resolves AWAY from
// the default root rather than onto it, because the failure being guarded is
// precisely "this account is looking at someone else's data".

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { retryOnTransientLock } from './fs-retry';

// Deliberately inside the root it claims, not in state.json: cowork-server
// read-modify-writes that same file, so a lost claim there would leak the root.
const CLAIM_FILE = '.account';

// Which account the app is signed in as, and which it last was. Written by the
// token store, so its lifetime is the session's.
const ACTIVE_FILE = 'active-account.json';

// Recorded once: did this install hold data before per-account roots existed?
const PRE_EXISTING_FILE = '.pre-existing-data';

// Remembers "start fresh", so the ownership question is asked once.
const DECLINED_FILE = '.declined-default-root';

const ROOT_DATA_MARKER = 'cowork.db';

// Per-account roots live under here, one subdirectory per account.
export const ACCOUNTS_DIR = 'accounts';

export type ClaimState =
  | { kind: 'unclaimed' }
  | { kind: 'claimed'; accountId: string }
  | { kind: 'unreadable' };

// Three session states, and the record distinguishes them because the token
// store writes it on sign-in and rewrites it on sign-out. `unknown` therefore
// means "this install has never signed in", not "we lost track".
export type ActiveAccount =
  | { kind: 'signed-in'; accountId: string }
  | { kind: 'signed-out'; lastAccountId: string | null }
  | { kind: 'unknown' };

// A Keycloak `sub` is a UUID; this only has to be a safe single path segment.
const SAFE_ACCOUNT_ID = /^[A-Za-z0-9._-]{1,128}$/;

const QUARANTINE_PREFIX = '_unresolved-';

/**
 * Where a session goes when the account cannot be named and the default root is
 * not safely ours. Unique per process: one shared bucket would let two
 * unresolvable sessions read each other's work.
 */
const QUARANTINE_ACCOUNT = `${QUARANTINE_PREFIX}${crypto.randomBytes(4).toString('hex')}`;

function isUsableAsPathSegment(accountId: string): boolean {
  return SAFE_ACCOUNT_ID.test(accountId) && accountId !== '.' && accountId !== '..';
}

function assertUsableAsPathSegment(accountId: string): void {
  if (!isUsableAsPathSegment(accountId)) {
    throw new Error('[account-data] refusing to derive a data root from an unexpected account id');
  }
}

function rootHoldsDatabase(root: string): boolean {
  try {
    return fs.existsSync(path.join(root, ROOT_DATA_MARKER));
  } catch {
    return true;
  }
}

/**
 * Observe, once, whether this install already had data.
 *
 * A live `cowork.db` test cannot answer this: the file exists on every install
 * that has ever started the sidecar, including a fresh one that only reached the
 * sign-in screen, so testing it live would ask a brand-new user whose data
 * theirs is. The question is only about the past, so it is answered once, before
 * this build can create anything, and never asked again. Call it at boot, ahead
 * of the first server start.
 */
export function observePreExistingData(home: string): void {
  const marker = path.join(home, PRE_EXISTING_FILE);
  try {
    if (fs.existsSync(marker)) return;
    const hadData = rootHoldsDatabase(home);
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ hadData }) + '\n', {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch (err) {
    console.warn('[account-data] could not record whether this install had data', err);
  }
}

/** The recorded answer. Unrecorded reads as "had data", keeping an account off a
 *  root we cannot vouch for rather than onto it. */
export function hadPreExistingData(home: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(home, PRE_EXISTING_FILE), 'utf-8');
    return (JSON.parse(raw) as { hadData?: unknown }).hadData !== false;
  } catch {
    return true;
  }
}

/** Every per-account root this install has created, by directory name. */
export function knownAccountRoots(home: string): string[] {
  try {
    return fs
      .readdirSync(path.join(home, ACCOUNTS_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Who owns `home`. `unreadable` is distinct from `unclaimed` on purpose: a
 * corrupt claim must never read as free, or the next account to sign in would
 * adopt a root that already holds someone's data.
 */
export function readAccountClaim(home: string): ClaimState {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(home, CLAIM_FILE), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'unclaimed' };
    return { kind: 'unreadable' };
  }
  try {
    const parsed = JSON.parse(raw) as { accountId?: unknown };
    const accountId = typeof parsed?.accountId === 'string' ? parsed.accountId.trim() : '';
    return accountId ? { kind: 'claimed', accountId } : { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}

function writeClaim(home: string, accountId: string): ClaimState {
  try {
    fs.mkdirSync(home, { recursive: true });
    // wx: an exclusive create IS the claim, so two accounts racing cannot both
    // win and neither can clobber a claim that already exists.
    fs.writeFileSync(path.join(home, CLAIM_FILE), JSON.stringify({ accountId }) + '\n', {
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
 * Claim the default root for an account signing in. Idempotent, and it never
 * steals: an existing claim comes back unchanged, and a write failure returns
 * `unreadable` so the caller takes a per-account root instead of sharing this
 * one.
 *
 * It refuses a root that held PRE-EXISTING data. Nobody has proven they own
 * that, and letting whoever signs in first take it is the reported bug. Only the
 * ownership dialog, through `adoptDefaultRootAsIncumbent`, may hand it over.
 */
export function claimDefaultRoot(home: string, accountId: string): ClaimState {
  const trimmed = accountId.trim();
  if (!trimmed) return { kind: 'unreadable' };
  const existing = readAccountClaim(home);
  if (existing.kind === 'unclaimed' && hadPreExistingData(home)) return existing;
  return writeClaim(home, trimmed);
}

/**
 * Hand the default root to an account, including one that held pre-existing
 * data. The only caller is the ownership dialog's answer: a person said the data
 * is theirs, which is the only evidence that exists.
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

function stageActiveAccount(
  home: string,
  accountId: string | null,
): { tmp: string; target: string } {
  let record: { accountId: string | null; lastAccountId: string | null };
  if (accountId === null) {
    // A sign-out keeps the account it was, read from the record rather than
    // passed in, because the caller has cleared its tokens by the time it gets
    // here. Without it a non-owning account would fall back onto the OWNER's
    // stores, and sign-out would then scrub the owner's credentials.
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
  return { tmp, target };
}

/** Record who is signed in, or `null` for a sign-out. Atomic, so a torn write
 *  cannot leave a half-parsed id that resolves to the wrong root. */
export async function writeActiveAccount(home: string, accountId: string | null): Promise<void> {
  const { tmp, target } = stageActiveAccount(home, accountId);
  try {
    await retryOnTransientLock(() => fs.renameSync(tmp, target));
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

/** The same, without the retry, for the synchronous auth choke point. Every
 *  sign-in re-records, so a write lost to a transient lock self-repairs. */
export function writeActiveAccountSync(home: string, accountId: string | null): void {
  const { tmp, target } = stageActiveAccount(home, accountId);
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

/**
 * Which account's stores this session uses. `null` means the default root and
 * therefore no override at all.
 *
 * A pure read, so the probe paths that decide whether to adopt a running server
 * reach the same answer as the spawn path without either writing a claim.
 *
 * | claim                    | signed in        | signed out        | never signed in |
 * |--------------------------|------------------|-------------------|-----------------|
 * | claimed by this account  | default          | default           | —               |
 * | claimed by another       | own              | own (last's)      | quarantine      |
 * | unclaimed, no old data   | default          | default           | default         |
 * | unclaimed, old data      | own (and asked)  | own (last's)      | see below       |
 * | unreadable               | own              | own (last's)      | quarantine      |
 *
 * The last cell is the one that cost the previous attempt an install's whole
 * history: a session that cannot name itself stays on the default root as long
 * as nobody has been partitioned here, because there is then no second identity
 * to leak to and this is the behaviour the install already had. Once
 * `accounts/*` exists that is no longer true, so it quarantines instead.
 */
export function resolveAccountRoot(home: string, active: ActiveAccount): string | null {
  const claim = readAccountClaim(home);

  const named =
    active.kind === 'signed-in' ? active.accountId
      : active.kind === 'signed-out' ? active.lastAccountId
        : null;

  if (named === null) {
    if (claim.kind !== 'unclaimed') return QUARANTINE_ACCOUNT;
    if (!hadPreExistingData(home)) return null;
    return knownAccountRoots(home).some((n) => !n.startsWith(QUARANTINE_PREFIX))
      ? QUARANTINE_ACCOUNT
      : null;
  }

  // Never throws: three callers in server-process.ts are not inside a try, so an
  // unusable recorded id would stop the sidecar starting on every launch.
  if (!isUsableAsPathSegment(named)) return QUARANTINE_ACCOUNT;

  if (claim.kind === 'claimed') return claim.accountId === named ? null : named;
  if (claim.kind === 'unclaimed') return hadPreExistingData(home) ? named : null;
  return named;
}

/** The absolute data root for a session: the shared home, or a subtree of it. */
export function accountDataHome(home: string, active: ActiveAccount): string {
  const account = resolveAccountRoot(home, active);
  return account === null ? home : path.join(home, ACCOUNTS_DIR, account);
}

/**
 * The sidecar's environment additions. One variable, because cowork-server
 * derives every store, the master key and the dotenv chain from it. Empty for
 * the account on the default root, so its environment is what it is today —
 * which is also what keeps prod's legacy `~/.anton/.env` fallback, since that is
 * dropped only when COWORK_HOME is set.
 */
export function sidecarEnvForSession(home: string, active: ActiveAccount): Record<string, string> {
  const root = accountDataHome(home, active);
  if (root === home) return {};
  if (root.includes(QUARANTINE_PREFIX)) {
    console.warn(
      '[account-data] cannot vouch for this machine\'s data for the current session — '
      + 'starting on an empty root. Signing in rewrites the account record.',
    );
  }
  return { COWORK_HOME: root };
}

/**
 * Whether the default root holds data nobody has claimed, while an account is
 * signed in. Only the person at the keyboard can say whose it is, so the shell
 * asks once.
 */
export function needsOwnershipDecision(home: string, active: ActiveAccount): boolean {
  if (active.kind !== 'signed-in') return false;
  if (!isUsableAsPathSegment(active.accountId)) return false;
  if (hasDeclinedDefaultRoot(home, active.accountId)) return false;
  return readAccountClaim(home).kind === 'unclaimed' && hadPreExistingData(home);
}

function declinedPath(home: string, accountId: string): string {
  return path.join(home, ACCOUNTS_DIR, accountId, DECLINED_FILE);
}

/** existsSync answers false for a missing OR non-traversable path rather than
 *  throwing, so a broken layout reads as "not answered" and the question comes
 *  back. Harmless: asking twice costs a dialog and the account is on its own
 *  root either way. */
export function hasDeclinedDefaultRoot(home: string, accountId: string): boolean {
  return fs.existsSync(declinedPath(home, accountId));
}

/** Record that this account chose not to take the unclaimed data. */
export function declineDefaultRoot(home: string, accountId: string): void {
  assertUsableAsPathSegment(accountId);
  const target = declinedPath(home, accountId);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '', { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    // Worst case the question is asked again; nothing is lost either way.
    console.warn('[account-data] could not record the ownership choice', err);
  }
}

/**
 * Remove empty quarantine roots. Nothing ever resolves back to one, so they
 * accumulate a store tree each; one holding a database holds somebody's work and
 * is left for a support path rather than tidied away. Call at boot.
 */
export function sweepStaleQuarantineRoots(home: string): void {
  for (const name of knownAccountRoots(home)) {
    if (!name.startsWith(QUARANTINE_PREFIX) || name === QUARANTINE_ACCOUNT) continue;
    const root = path.join(home, ACCOUNTS_DIR, name);
    if (rootHoldsDatabase(root)) {
      console.warn('[account-data] a quarantined session left data behind at %s', root);
      continue;
    }
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (err) {
      console.warn('[account-data] could not remove a stale quarantine root', err);
    }
  }
}

/**
 * Bind a server-owner secret to an account.
 *
 * Adoption matches on this value, and the secret alone is one value per OS user
 * per build — so without the account in it, an orphan sidecar still holding the
 * PREVIOUS account's database matches and gets adopted. HMAC so the secret is
 * never exposed by what we publish at /health, and the secret unchanged when
 * there is no account, so default-root installs keep today's token exactly.
 */
export function accountOwnerToken(secret: string, accountId: string | null): string {
  if (!accountId) return secret;
  return crypto.createHmac('sha256', secret).update(accountId).digest('hex');
}
