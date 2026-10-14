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
// Ownership is an exclusive create, written whole and then linked into place,
// so the filesystem picks the winner and no account can overwrite another's
// claim. Everything unproven resolves AWAY from the default root rather than
// onto it, because the failure being guarded is precisely "this account is
// looking at someone else's data".

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CREDENTIAL_ENV_KEYS } from './credential-env-keys';
import { retryOnTransientLock } from './fs-retry';

// Deliberately inside the root it claims, not in state.json: cowork-server
// read-modify-writes that same file, so a lost claim there would leak the root.
const CLAIM_FILE = '.account';

// Which organization owns an account root's stores. A separate file from
// CLAIM_FILE so an account root can hold both, and so a corrupt one is never
// read as the other.
const ORG_CLAIM_FILE = '.organization';

// Which organization the session is operating as. At the ACCOUNT root, one
// level above the store roots it selects between, and written on every auth
// transition rather than only on a user's explicit pick.
const ACTIVE_ORG_FILE = 'active-org.json';

// Which account the app is signed in as, and which it last was. Written by the
// token store, so its lifetime is the session's.
const ACTIVE_FILE = 'active-account.json';

// Recorded once: did this install hold data before per-account roots existed?
const PRE_EXISTING_FILE = '.pre-existing-data';

// Remembers that the ownership question has been answered. Install-level, not
// per account: the data belongs to one person, so the first answer settles it
// for everyone. A per-account marker meant that after one account disclaimed the
// data the NEXT account was offered it, which is a worse position to offer it
// from, not a better one.
const SETTLED_FILE = '.ownership-settled';

// What makes a root "already someone's". The database is not enough on its own:
// an install whose onboarding stored provider keys but whose sidecar never
// started successfully has no database at all.
const ROOT_DATA_MARKER = 'cowork.db';
const PROVIDER_STATE_MARKER = 'state.json';
const ENV_FILE = '.env';
// Contents, never mere existence: the sidecar mkdirs its stores on first start,
// so an install that only ever reached the sign-in screen has the empty
// directories already.
const USER_DATA_DIRS = ['data-vault', 'projects', 'files', 'memory', 'skills'];

// Per-account roots live under here, one subdirectory per account.
export const ACCOUNTS_DIR = 'accounts';

// Per-organization store roots live under here, inside ONE account's root.
export const ORGS_DIR = 'orgs';

export type ClaimState =
  | { kind: 'unclaimed' }
  | { kind: 'claimed'; accountId: string }
  | { kind: 'unreadable' };

export type OrgClaimState =
  | { kind: 'unclaimed' }
  | { kind: 'claimed'; orgId: string }
  | { kind: 'unreadable' };

// What the two claims share. They differ only in the file they live in and the
// key they store, so the exclusive-create machinery below is written once.
type ClaimRecord =
  | { kind: 'unclaimed' }
  | { kind: 'claimed'; id: string }
  | { kind: 'unreadable' };

// Four session states, and the record distinguishes them because the token store
// writes it on sign-in and rewrites it on sign-out. `unknown` therefore means
// "this install has never signed in", not "we lost track" — that is
// `unresolved`, which is a session that IS signed in and cannot be named, and
// the two must stay apart: `unknown` may fall back to the default root on an
// install whose incumbent owns it, and a real session doing that is the leak.
export type ActiveAccount =
  | { kind: 'signed-in'; accountId: string }
  | { kind: 'signed-out'; lastAccountId: string | null }
  | { kind: 'unresolved' }
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

function dirHoldsEntries(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false; // missing, or not a directory
  }
}

/**
 * Whether this root's `.env` holds a provider credential.
 *
 * The file itself proves nothing: the sidecar writes one to hold a generated
 * COWORK_AUTH_TOKEN, and the desktop writes consent flags into it, so a plain
 * launch produces a dotenv on an install nobody has configured. A credential
 * key with a value does prove it.
 */
function envHoldsCredential(root: string): boolean {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, ENV_FILE), 'utf-8');
  } catch {
    return false; // missing or unreadable
  }
  return text.split('\n').some((line) => {
    const eq = line.indexOf('=');
    if (eq <= 0 || line.trimStart().startsWith('#')) return false;
    return CREDENTIAL_ENV_KEYS.includes(line.slice(0, eq).trim())
      && line.slice(eq + 1).trim() !== '';
  });
}

/**
 * Whether this root already holds data that belongs to a person.
 *
 * Testing the database alone was too narrow. An install that persisted provider
 * keys but never got a working sidecar has no `cowork.db`, so it recorded as
 * empty and the first account to sign in would claim it and inherit those
 * credentials, and the connector vault, with nobody asked.
 */
function rootHoldsUserData(root: string): boolean {
  try {
    if (fs.existsSync(path.join(root, ROOT_DATA_MARKER))) return true;
    if (fs.existsSync(path.join(root, PROVIDER_STATE_MARKER))) return true;
    if (envHoldsCredential(root)) return true;
    return USER_DATA_DIRS.some((name) => dirHoldsEntries(path.join(root, name)));
  } catch {
    // Unreadable. Assume there is something here and ask, rather than handing
    // it to whoever signs in first.
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
export function observePreExistingData(home: string, incumbentAccountId: string | null = null): void {
  const marker = path.join(home, PRE_EXISTING_FILE);
  try {
    if (fs.existsSync(marker)) return;
    const hadData = rootHoldsUserData(home);
    // Only meaningful alongside data. On a fresh install the first account
    // claims the root through the ordinary path, so recording an identity here
    // would be state kept for nothing.
    const incumbent = hadData && incumbentAccountId && isUsableAsPathSegment(incumbentAccountId)
      ? incumbentAccountId
      : null;
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ hadData, incumbent }) + '\n', {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch (err) {
    console.warn('[account-data] could not record whether this install had data', err);
  }
}

/**
 * The account that was signed in on the build that created this install's data.
 *
 * Read from the session that survived the upgrade, at the same moment the data
 * itself was observed, so it says "this account was signed in on the build that
 * made this" rather than the far weaker "this account is signed in now". An
 * account arriving later cannot produce that state, which is what makes this
 * safe to act on without asking anybody.
 */
export function recordedIncumbent(home: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(home, PRE_EXISTING_FILE), 'utf-8');
    const value = (JSON.parse(raw) as { incumbent?: unknown }).incumbent;
    return typeof value === 'string' && isUsableAsPathSegment(value) ? value : null;
  } catch {
    return null;
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
function readClaimRecord(dir: string, file: string, key: string): ClaimRecord {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dir, file), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'unclaimed' };
    return { kind: 'unreadable' };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const id = typeof parsed?.[key] === 'string' ? (parsed[key] as string).trim() : '';
    return id ? { kind: 'claimed', id } : { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}

export function readAccountClaim(home: string): ClaimState {
  const claim = readClaimRecord(home, CLAIM_FILE, 'accountId');
  return claim.kind === 'claimed' ? { kind: 'claimed', accountId: claim.id } : claim;
}

function writeClaimRecord(dir: string, file: string, key: string, id: string): ClaimRecord {
  // Written whole to a temp and then LINKED into place. link() fails with
  // EEXIST if the target is there, so it keeps the exclusive-create semantics
  // that make the claim safe against two launches racing — while never leaving a
  // half-written claim behind. A torn claim reads as `unreadable`, which sends
  // every account to its own root and can never be repaired, so this file is one
  // that must not be writable in a partial state.
  const target = path.join(dir, file);
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ [key]: id }) + '\n', {
      encoding: 'utf-8',
      mode: 0o600,
    });
    try {
      fs.linkSync(tmp, target);
    } catch (linkErr) {
      if ((linkErr as NodeJS.ErrnoException).code === 'EEXIST') throw linkErr;
      // Some filesystems cannot hard-link (exFAT, certain Windows policies).
      // Falling back to an exclusive create keeps the install usable: it is
      // what this did before, and a torn claim there is far less bad than an
      // install that can never claim or adopt its own root at all.
      fs.writeFileSync(target, JSON.stringify({ [key]: id }) + '\n', {
        encoding: 'utf-8',
        mode: 0o600,
        flag: 'wx',
      });
    }
    return { kind: 'claimed', id };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return { kind: 'unreadable' };
    return readClaimRecord(dir, file, key);
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
  }
}

function writeClaim(home: string, accountId: string): ClaimState {
  const claim = writeClaimRecord(home, CLAIM_FILE, 'accountId', accountId);
  return claim.kind === 'claimed' ? { kind: 'claimed', accountId: claim.id } : claim;
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
// Quarantine held in memory, for when the DISK cannot be made to say it. The
// record on disk is the authority whenever it can be written; this covers the
// one case it cannot, where marking the session unresolved AND removing the
// record both failed and the file still names the previous account.
//
// Process-lifetime on purpose: a disk that refuses these writes will not
// improve within the session, and every root that belongs to somebody is the
// wrong one for a session that cannot say who it is.
let _sessionUnresolved = false;

/** Quarantine this session for the life of the process. Called only when the
 *  record on disk could neither be marked unresolved nor removed, so nothing
 *  read from it can be trusted to name this session. */
export function markSessionUnresolvedInMemory(): void {
  _sessionUnresolved = true;
}

/** Sign-out clears it: the next session gets to establish its own identity, and
 *  a stale quarantine would strand an install that has since recovered. */
export function clearInMemorySessionQuarantine(): void {
  _sessionUnresolved = false;
}

export function readActiveAccount(home: string): ActiveAccount {
  // Ahead of the file, which is exactly what this exists to override.
  if (_sessionUnresolved) return { kind: 'unresolved' };

  let raw: string;
  try {
    raw = fs.readFileSync(path.join(home, ACTIVE_FILE), 'utf-8');
  } catch {
    return { kind: 'unknown' };
  }
  try {
    const parsed = JSON.parse(raw) as {
      accountId?: unknown;
      lastAccountId?: unknown;
      unresolved?: unknown;
    };
    // Ahead of everything else: the marker is written precisely because no id
    // can be trusted here, so no id in the file may outvote it.
    if (parsed?.unresolved === true) return { kind: 'unresolved' };
    const last = typeof parsed?.lastAccountId === 'string' ? parsed.lastAccountId.trim() : '';
    if (parsed?.accountId === null) return { kind: 'signed-out', lastAccountId: last || null };
    const accountId = typeof parsed?.accountId === 'string' ? parsed.accountId.trim() : '';
    return accountId ? { kind: 'signed-in', accountId } : { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}

function stageUnresolved(home: string): { tmp: string; target: string } {
  fs.mkdirSync(home, { recursive: true });
  const target = path.join(home, ACTIVE_FILE);
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify({ unresolved: true }) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return { tmp, target };
}

function stageActiveAccount(
  home: string,
  accountId: string | null,
): { tmp: string; target: string } {
  let record: { accountId: string | null; lastAccountId: string | null } | { unresolved: true };
  if (accountId === null) {
    // A sign-out keeps the account it was, read from the record rather than
    // passed in, because the caller has cleared its tokens by the time it gets
    // here. Without it a non-owning account would fall back onto the OWNER's
    // stores, and sign-out would then scrub the owner's credentials.
    const current = readActiveAccount(home);
    // Signing out does not make an unnameable session nameable, and a record
    // with no name in it resolves back onto the default root. That is the same
    // scrub, aimed at the incumbent.
    if (current.kind === 'unresolved') return stageUnresolved(home);
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
 * Record that a session is signed in and cannot be named, so it resolves to a
 * quarantine root rather than to whichever account the file still named.
 *
 * Atomic like the other writers: a torn record here would read as an id.
 */
export function markActiveAccountUnresolved(home: string): void {
  const { tmp, target } = stageUnresolved(home);
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

/**
 * Remove the record entirely, so the session reads as never-signed-in.
 *
 * Last resort for a caller that could not write the record OR mark it
 * unresolved, and weaker than either: an absent record resolves to the DEFAULT
 * root on an install whose claim is held by its recorded incumbent, so a
 * session landing here can still read that account's data. It beats leaving a
 * record that names somebody else only because it takes no side.
 */
export function clearActiveAccountRecord(home: string): void {
  fs.rmSync(path.join(home, ACTIVE_FILE), { force: true });
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
 * A signed-in session that cannot be named (`unresolved`) is not in the table:
 * it quarantines whatever the claim says.
 *
 * The last cell is the load-bearing one: a session that cannot name itself stays
 * on the default root as long as nobody has been partitioned here, because there
 * is then no second identity to leak to and this is the behaviour the install
 * already had. Once `accounts/*` exists that is no longer true, so it
 * quarantines instead.
 */
export function resolveAccountRoot(home: string, active: ActiveAccount): string | null {
  // No cell of the table applies: this session is real and unnameable, so every
  // root that belongs to somebody is the wrong one, the default root included.
  if (active.kind === 'unresolved') return QUARANTINE_ACCOUNT;

  const claim = readAccountClaim(home);

  const named =
    active.kind === 'signed-in' ? active.accountId
      : active.kind === 'signed-out' ? active.lastAccountId
        : null;

  if (named === null) {
    // The incumbent's own claim, before the session that names it has been
    // re-established. An offline upgraded launch is exactly this: the claim is
    // written at boot, the account record is not written until a refresh
    // succeeds, and quarantining here would show the install's only user an
    // empty app. Nobody else reaches this branch — a second account is signed
    // in, so it names itself — and an incumbent is never asked, so a claim held
    // by anyone else cannot be theirs.
    if (claim.kind === 'claimed' && claim.accountId === recordedIncumbent(home)) return null;
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

// The organization half of `_sessionUnresolved`, and it exists for the same
// failure: a disk that refuses both the rewrite and the removal leaves a record
// naming the organization being LEFT while the token names the one being
// entered. Null alone is not enough to fail closed here — an unclaimed,
// unpartitioned root resolves null straight back to itself — so `orgStoreRoot`
// consults this directly rather than inferring it from the value.
//
// Lifted by the next record that lands, like the account one: a session that
// can say who it is again has nothing left to protect against.
let _organizationUnresolved = false;

/** Quarantine this session's ORGANIZATION for as long as the disk refuses to
 *  record it. Called only when the record could neither be rewritten nor
 *  removed, so nothing read from it names this session's organization. */
export function markOrganizationUnresolvedInMemory(): void {
  _organizationUnresolved = true;
}

/** Test seam and sign-out reset; the ordinary lift happens on the next write. */
export function clearOrganizationQuarantine(): void {
  _organizationUnresolved = false;
}

/** The organization this account root is operating as, or null if none is
 *  recorded. Null resolves to the account root while nothing has partitioned,
 *  which is what keeps an upgraded install on its own data. */
export function readActiveOrg(accountRoot: string): string | null {
  // Ahead of the file, for the same reason the account record has an in-memory
  // quarantine: when the record can neither be rewritten nor removed it still
  // names the PREVIOUS organization, and every check downstream compares
  // against it and agrees, so the sidecar is never moved off those stores.
  if (_organizationUnresolved) return null;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(accountRoot, ACTIVE_ORG_FILE), 'utf-8'),
    ) as { orgId?: unknown };
    const orgId = typeof parsed?.orgId === 'string' ? parsed.orgId.trim() : '';
    return orgId && isUsableAsPathSegment(orgId) ? orgId : null;
  } catch {
    return null;
  }
}

/**
 * Record the organization this session is operating as. THROWS on failure, and
 * that is the point.
 *
 * Swallowing it would leave the record naming the PREVIOUS organization, so
 * `sidecarIsOnCurrentStores()` would compare two stale values, agree, skip the
 * restart, and report a successful switch while the sidecar still served the
 * previous organization's database. Callers fail the switch closed instead.
 */
export function writeActiveOrgSync(accountRoot: string, orgId: string | null): void {
  const target = path.join(accountRoot, ACTIVE_ORG_FILE);
  if (orgId === null) {
    try {
      fs.rmSync(target, { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return;
  }
  assertUsableAsPathSegment(orgId);
  fs.mkdirSync(accountRoot, { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ orgId }) + '\n', { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, target);
    // The record names this session's organization again, so a held quarantine
    // has nothing left to protect against.
    _organizationUnresolved = false;
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
  }
}

/** Who owns an account root's stores. Same shape and same reasons as
 *  `readAccountClaim`: a corrupt claim must never read as free. */
export function readOrgClaim(accountRoot: string): OrgClaimState {
  const claim = readClaimRecord(accountRoot, ORG_CLAIM_FILE, 'orgId');
  return claim.kind === 'claimed' ? { kind: 'claimed', orgId: claim.id } : claim;
}

/**
 * Claim an account root's stores for an organization. Idempotent and it never
 * steals: an existing claim comes back unchanged.
 *
 * Unlike `claimDefaultRoot` this does NOT gate on `hadPreExistingData`. That
 * marker is only ever written at the shared home and reads true whenever it is
 * missing, which it always is at an account root, so gating on it here would
 * mean no organization claim is ever written and every organization would
 * collapse back onto the account root.
 */
export function claimOrgRoot(accountRoot: string, orgId: string): OrgClaimState {
  const trimmed = orgId.trim();
  if (!trimmed || !isUsableAsPathSegment(trimmed)) return { kind: 'unreadable' };
  const existing = readOrgClaim(accountRoot);
  if (existing.kind === 'claimed') return existing;
  const claim = writeClaimRecord(accountRoot, ORG_CLAIM_FILE, 'orgId', trimmed);
  return claim.kind === 'claimed' ? { kind: 'claimed', orgId: claim.id } : claim;
}

/**
 * Every organization subtree this account root has created, quarantine buckets
 * excluded. The exclusion matters: a quarantined subtree the sidecar wrote to is
 * never reaped, so counting it would make "has this root been partitioned"
 * permanently true and strand the owning organization in an empty subtree.
 */
export function knownOrgRoots(accountRoot: string): string[] {
  return listOrgSegments(accountRoot).filter((name) => !name.startsWith(QUARANTINE_PREFIX));
}

/** Every organization subtree directory under an account root, quarantine
 *  buckets included. Callers that must not count a quarantine bucket filter it
 *  themselves, because the two questions differ: "has this root been
 *  partitioned" excludes them, "is this orphan one of ours" does not. */
export function listOrgSegments(accountRoot: string): string[] {
  try {
    return fs
      .readdirSync(path.join(accountRoot, ORGS_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Where an organization's stores live: the account root itself for the
 * organization that owns it, a subtree beside it otherwise.
 *
 * Everything unproven resolves AWAY from the account root, the same rule
 * `resolveAccountRoot` follows, because the failure being guarded is precisely
 * "this organization is looking at another organization's data". The one
 * exception is an install that has never partitioned and holds no claim: there
 * is no second organization to leak to yet, and this is the behaviour the
 * install already had, so an upgrade keeps its data where it is.
 */
export function orgStoreRoot(accountRoot: string, orgId: string | null): string {
  const quarantine = () => path.join(accountRoot, ORGS_DIR, QUARANTINE_ACCOUNT);
  // Before anything derived from the record, because the record is exactly what
  // cannot be trusted here. Null would otherwise resolve to the account root
  // on an unclaimed, unpartitioned install — the stores of whoever was already
  // there, which is the outcome the quarantine exists to prevent.
  if (_organizationUnresolved) return quarantine();
  const claim = readOrgClaim(accountRoot);
  const partitioned = knownOrgRoots(accountRoot).length > 0;

  if (orgId === null) {
    return claim.kind === 'claimed' || partitioned ? quarantine() : accountRoot;
  }
  if (!isUsableAsPathSegment(orgId)) return quarantine();
  if (claim.kind === 'claimed') {
    return claim.orgId === orgId ? accountRoot : path.join(accountRoot, ORGS_DIR, orgId);
  }
  if (claim.kind === 'unreadable') return path.join(accountRoot, ORGS_DIR, orgId);
  return partitioned ? path.join(accountRoot, ORGS_DIR, orgId) : accountRoot;
}

/**
 * The sidecar's per-organization store overrides. Empty for the organization
 * that owns the account root, so its environment is exactly what it is today.
 *
 * COWORK_HOME deliberately stays at the account root: it carries the .env, the
 * desktop state.json, the master key and the OAuth state, none of which is
 * rewritten on an organization switch, so moving it would leave a switched-to
 * organization with no provider configured. Every entry here corresponds to a
 * cowork-server setting whose default derives from cowork_home();
 * tests/test_cowork_home.py fails if one is added there without being added here.
 */
export function orgStoreEnv(accountRoot: string, orgId: string | null): Record<string, string> {
  const root = orgStoreRoot(accountRoot, orgId);
  if (root === accountRoot) return {};
  return {
    // Built exactly as cowork-server builds its own default (app_settings.py),
    // so the two cannot diverge. A '?' in the path truncates it there and here
    // alike; percent-encoding does not round-trip through make_url, so it would
    // point at a different directory rather than fix anything.
    DATABASE_URI: `sqlite:///${path.join(root, 'cowork.db')}`,
    COWORK_PROJECTS_DIR: path.join(root, 'projects'),
    COWORK_FILES_DIR: path.join(root, 'files'),
    COWORK_SKILLS_DIR: path.join(root, 'skills'),
    COWORK_VAULT_DIR: path.join(root, 'data-vault'),
    COWORK_MEMORY_DIR: path.join(root, 'memory'),
    COWORK_STREAMS_DIR: path.join(root, 'streams'),
    COWORK_CODING_DIR: path.join(root, 'coding'),
    ANTON_SKILLS_ROOT_DIR: path.join(root, 'anton', 'skills'),
    // The directory, not the file: publish.py appends state.json itself.
    ANTON_COWORK_STATE_DIR: root,
  };
}

/** What the renderer does with browser-local state carrying no account marker.
 *  The renderer's own copy of this union is in `cowork/lib/accountLocalState`. */
export type LegacyCacheVerdict = 'keep' | 'purge' | 'undecided';

/**
 * What the renderer is told about this session, for the one job it has with it:
 * dropping browser-local state that belongs to another account.
 *
 * A session that cannot be named is given the QUARANTINE root's name rather
 * than no name at all. localStorage is keyed by account, and a session with no
 * key purges nothing, so the previous account's drafts would stay on screen for
 * a session the sidecar has already been moved away from that account for.
 */
export function rendererAccountSession(
  home: string,
): { accountId: string | null; legacyState: LegacyCacheVerdict } {
  const active = readActiveAccount(home);
  const root = resolveAccountRoot(home, active);
  const accountId =
    active.kind === 'signed-in' ? active.accountId
      : active.kind === 'unresolved' ? root
        : null;
  const legacyState: LegacyCacheVerdict = needsOwnershipDecision(home, active)
    ? 'undecided'
    : root === null ? 'keep' : 'purge';
  return { accountId, legacyState };
}

/**
 * Whether to ask this account who owns the data on this machine.
 *
 * Asked only when there is nothing better to go on. A recorded incumbent is
 * better: that account takes the root without being asked, and no OTHER account
 * is offered it, so the question cannot be answered by the wrong person.
 *
 * What remains is an install that has data and whose session did not survive
 * the upgrade. Nothing on disk names the owner there — desktop rows carry no
 * `created_by`, which is the whole reason this exists — so the person at the
 * keyboard is the only source, and they are asked ONCE for the install.
 */
export function needsOwnershipDecision(home: string, active: ActiveAccount): boolean {
  if (active.kind !== 'signed-in') return false;
  if (!isUsableAsPathSegment(active.accountId)) return false;
  if (isOwnershipSettled(home)) return false;
  // An incumbent is known, so nobody is asked: they get the root at boot, and
  // this guard is what keeps a second account from being offered it if that
  // claim could not be written.
  if (recordedIncumbent(home) !== null) return false;
  return readAccountClaim(home).kind === 'unclaimed' && hadPreExistingData(home);
}

/**
 * Give the recorded incumbent the root it was already using, once.
 *
 * The claim is what every other account's resolution reads, so writing it at
 * boot means no other code path has to know about incumbency. Returns the
 * account that ends up owning the root, or null when there is nothing to do.
 */
export function claimForRecordedIncumbent(home: string): string | null {
  const incumbent = recordedIncumbent(home);
  if (incumbent === null) return null;
  const claim = readAccountClaim(home);
  if (claim.kind === 'claimed') return claim.accountId;
  if (claim.kind === 'unreadable') return null;
  const settled = adoptDefaultRootAsIncumbent(home, incumbent);
  if (settled.kind !== 'claimed') {
    console.warn('[account-data] could not give the default root to its incumbent');
    return null;
  }
  return settled.accountId;
}

function settledPath(home: string): string {
  return path.join(home, SETTLED_FILE);
}

/** Anything present at that path counts as answered, a directory included: a
 *  layout broken enough to fail the write reads as settled, which strands the
 *  data behind a support path instead of offering it to whoever signs in. That
 *  is the direction to fail in. */
export function isOwnershipSettled(home: string): boolean {
  return fs.existsSync(settledPath(home));
}

/**
 * Record that the question has been answered, whichever way, for the install.
 *
 * Adopting also lands a claim, which stops the question on its own; this is what
 * makes DECLINING final. Otherwise the next account to sign in would be offered
 * data the previous one had just disclaimed.
 */
export function settleOwnership(home: string): void {
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(settledPath(home), '', { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    // Worst case the question is asked once more; nothing is lost either way.
    console.warn('[account-data] could not record the ownership choice', err);
  }
}

/**
 * Remove empty quarantine roots. Nothing ever resolves back to one, so they
 * accumulate a store tree each; one holding any of somebody's work is left for a
 * support path rather than tidied away. Call at boot.
 */
function reapQuarantineRoot(root: string, name: string): void {
  if (!name.startsWith(QUARANTINE_PREFIX) || name === QUARANTINE_ACCOUNT) return;
  if (rootHoldsUserData(root)) {
    console.warn('[account-data] a quarantined session left data behind at %s', root);
    return;
  }
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (err) {
    console.warn('[account-data] could not remove a stale quarantine root', err);
  }
}

/** Quarantine buckets under every root this install can create: the account
 *  roots, and the organization subtrees inside each of them. The default root's
 *  organization subtrees sit at `<home>/orgs`, because the account that owns it
 *  has no `accounts/<id>` directory of its own, and a single-account install is
 *  the common case rather than the rare one. */
export function sweepStaleQuarantineRoots(home: string): void {
  const accountRoots = [home, ...knownAccountRoots(home).map((n) => path.join(home, ACCOUNTS_DIR, n))];
  for (const accountRoot of accountRoots) {
    for (const name of listOrgSegments(accountRoot)) {
      reapQuarantineRoot(path.join(accountRoot, ORGS_DIR, name), name);
    }
  }
  for (const name of knownAccountRoots(home)) {
    reapQuarantineRoot(path.join(home, ACCOUNTS_DIR, name), name);
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
