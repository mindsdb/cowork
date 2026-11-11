import { diagnostic } from '../shared/diagnostics';
import { safeStorage, app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  claimDefaultRoot,
  claimOrgRoot,
  clearActiveAccountRecord,
  clearInMemorySessionQuarantine,
  markActiveAccountUnresolved,
  markOrganizationUnresolvedInMemory,
  markSessionUnresolvedInMemory,
  readActiveOrg,
  readOrgClaim,
  writeActiveAccountSync,
  writeActiveOrgSync,
} from './account-data';
import { accountIdFromToken, activeOrgIdFromToken } from './jwt';
import { accountDataRoot, coworkHome } from './cowork-home';
import { IPC } from '../shared/ipc-channels';
import { retryOnTransientLock } from './fs-retry';
import { registerQuitFlush } from './quit-flush';

// Persistence for the Keycloak refresh token.
//
// The token lives in memory for the whole process. initTokenStore() loads it
// once after app ready; saveTokens() and clearTokens() change memory at once
// while a serialized queue writes the disk. That keeps the synchronous API the
// auth code is built on, while safeStorage itself is async only.
//
// On every platform the token is encrypted with safeStorage into
// userData/mindshub-refresh.bin. refresh-token.dat is written only while
// safeStorage is unavailable, and removed once a secure write lands.
//
// macOS: safeStorage keeps its key in the Keychain item "<app name> Safe
// Storage". Its ACL trusts the app's designated requirement (bundle id plus
// Team ID), so signed updates read it without a prompt. An install whose item
// predates the bundle id change is prompted for Keychain access: Always Allow
// ends the prompts, a plain Allow repeats them every launch. A refusal, including
// a Deny, is recorded in KEYCHAIN_UNAVAILABLE_MARKER and keeps the install on
// the fallback file, so the user is not asked again on every launch. Deleting
// the marker file brings the Keychain back.

const SECURE_FILE = path.join(app.getPath('userData'), 'mindshub-refresh.bin');
const FALLBACK_FILE = path.join(coworkHome(), 'refresh-token.dat');
const SECURE_TMP = `${SECURE_FILE}.tmp`;
const FALLBACK_TMP = `${FALLBACK_FILE}.tmp`;
// Short on purpose: a target that is never writable also fails with
// EPERM/EACCES and would spend the whole budget on every write, and two files'
// worth must fit inside the quit flush ceiling.
const WRITE_RETRY = { attempts: 4, baseDelayMs: 60 };
const IS_MAC = process.platform === 'darwin';
const KEYCHAIN_UNAVAILABLE_MARKER = path.join(app.getPath('userData'), 'keychain-unavailable');

type StoreKind = 'secure' | 'fallback';

// ── Fallback file encryption ────────────────────────────────────────

// Key derived from public values: this only keeps the token from sitting on
// disk in plaintext. The real protection is the file's 0600 mode.
function deriveKey(): Buffer {
  const seed = `mindshub-cowork:${app.getPath('userData')}`;
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptToken(plaintext: string): Buffer {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted]);
}

function decryptToken(data: Buffer): string {
  const key = deriveKey();
  const iv = data.subarray(0, 16);
  const encrypted = data.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// ── Files ───────────────────────────────────────────────────────────

// ENOENT is the expected case (nothing to remove); anything else means a
// stale token may survive and shadow a rotated one later — say so.
function removeStaleStore(file: string): void {
  try { fs.unlinkSync(file); } catch (e: any) {
    if (e?.code !== 'ENOENT') diagnostic("main.token-store", "WARNING", "token_store_could_not_remove_stale_token_store", `[token-store] could not remove stale token store ${file}`, e);
  }
}

function mtimeMs(file: string): number | null {
  try { return fs.statSync(file).mtimeMs; } catch { return null; }
}

function readFallbackFile(): string | null {
  try {
    return decryptToken(fs.readFileSync(FALLBACK_FILE));
  } catch (e: any) {
    if (e?.code !== 'ENOENT') diagnostic("main.token-store", "WARNING", "token_store_fallback_file_unreadable", '[token-store] fallback token file is unreadable', e);
    return null;
  }
}

const STORE_FILES = {
  secure: { file: SECURE_FILE, tmp: SECURE_TMP },
  fallback: { file: FALLBACK_FILE, tmp: FALLBACK_TMP },
} as const;

// Each attempt checks the generation and writes in one synchronous run, so a
// saveTokens or clearTokens can land only between attempts, never between the
// check and the rename. Resolves false when a newer one made this write stale.
async function writeStore(kind: StoreKind, token: string, data: Buffer, generation: number): Promise<boolean> {
  const { file, tmp } = STORE_FILES[kind];
  // Removing the other kind's file keeps an older token there from shadowing
  // this one once the stores change roles.
  const staleCopy = STORE_FILES[kind === 'secure' ? 'fallback' : 'secure'].file;
  try {
    const written = await retryOnTransientLock(() => {
      if (generation !== _persistGeneration) return false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.rmSync(tmp, { force: true });
      // mode applies only when a file is created; the fresh temp file carries
      // it onto the target through the rename.
      fs.writeFileSync(tmp, data, { mode: 0o600 });
      fs.renameSync(tmp, file);
      removeStaleStore(staleCopy);
      return true;
    }, WRITE_RETRY);
    if (written && generation === _persistGeneration) _lastPersisted = { token, kind };
    return written;
  } finally {
    removeStaleStore(tmp);
  }
}

function deleteTokenFiles(): void {
  for (const { file, tmp } of Object.values(STORE_FILES)) {
    removeStaleStore(file);
    removeStaleStore(tmp);
  }
}

// ── safeStorage ─────────────────────────────────────────────────────

async function secureStoreAvailable(): Promise<boolean> {
  if (keychainRefused()) return false;
  let available: boolean;
  try {
    available = await safeStorage.isAsyncEncryptionAvailable();
  } catch (e) {
    // A throw says nothing about the user's choice, so it must not pin the
    // install to the fallback file; only a false answer counts as a refusal.
    diagnostic("main.token-store", "WARNING", "token_store_async_encryption_check_failed", '[token-store] safeStorage availability check failed', e);
    return false;
  }
  if (!available) recordKeychainRefusal('availability_false', null);
  return available;
}

function keychainRefused(): boolean {
  return IS_MAC && fs.existsSync(KEYCHAIN_UNAVAILABLE_MARKER);
}

// macOS only. Windows DPAPI never asks, and on Linux a refusal is often
// temporary, so neither is worth pinning.
function recordKeychainRefusal(reason: 'availability_false' | 'encrypt_failed', error: unknown): void {
  if (!IS_MAC) return;
  const record = {
    reason,
    error: error instanceof Error ? error.message : error == null ? null : String(error),
    at: new Date().toISOString(),
    appVersion: app.getVersion(),
  };
  try {
    fs.mkdirSync(path.dirname(KEYCHAIN_UNAVAILABLE_MARKER), { recursive: true });
    fs.writeFileSync(KEYCHAIN_UNAVAILABLE_MARKER, JSON.stringify(record) + '\n', { mode: 0o600 });
    diagnostic("main.token-store", "WARNING", "token_store_keychain_unavailable_marker_written", `[token-store] Keychain unavailable (${reason}); this install stays on the fallback file`, error);
  } catch (e) {
    diagnostic("main.token-store", "WARNING", "token_store_could_not_write_keychain_unavailable_marker", '[token-store] could not record the Keychain refusal', e);
  }
}

// ── State ───────────────────────────────────────────────────────────

let _accessToken: string | null = null;
let _expiresAt = 0; // epoch ms
let _tokenStoreVersion = 0;
let _refreshToken: string | null = null;
let _initialized = false;
let _initPromise: Promise<void> | null = null;
let _warnedReadBeforeInit = false;
let _warnedPinnedFallback = false;
// Bumped by every saveTokens that carries a refresh token and by clearTokens.
// A queued write or a startup load that finds it changed is stale and drops out.
let _persistGeneration = 0;
// What the disk already holds, so an unchanged token is not re-encrypted on
// every access-token refresh.
let _lastPersisted: { token: string; kind: StoreKind } | null = null;
let _releaseWrites!: () => void;
// Writes start only after initTokenStore finished, so nothing the startup load
// removes can be a file a write just produced.
let _persistChain: Promise<void> = new Promise<void>((resolve) => { _releaseWrites = resolve; });

// ── Startup load ────────────────────────────────────────────────────

export function initTokenStore(): Promise<void> {
  if (!_initPromise) {
    _initPromise = loadAtStartup()
      .catch((e) => {
        diagnostic("main.token-store", "WARNING", "token_store_startup_load_failed", '[token-store] could not load the stored session', e);
      })
      .finally(() => {
        _initialized = true;
        _releaseWrites();
      });
  }
  return _initPromise;
}

async function loadAtStartup(): Promise<void> {
  const generation = _persistGeneration;
  removeStaleStore(SECURE_TMP);
  removeStaleStore(FALLBACK_TMP);

  const secureTime = mtimeMs(SECURE_FILE);
  const fallbackTime = mtimeMs(FALLBACK_FILE);
  if (secureTime === null && fallbackTime === null) return;
  // With both present the newer one is current. Equal times favour the secure
  // file: the previous build wrote the same token to both in one go.
  const source: StoreKind =
    secureTime !== null && (fallbackTime === null || secureTime >= fallbackTime) ? 'secure' : 'fallback';

  const available = await secureStoreAvailable();
  const target: StoreKind = available ? 'secure' : 'fallback';

  if (source === 'secure' && !available) {
    diagnostic("main.token-store", "WARNING", "token_store_secure_store_unavailable_at_startup", '[token-store] safeStorage unavailable at startup; keeping the stored session for the next launch');
    // An older fallback file may hold a token rotated out since. Only one
    // written in the same instant is the same token.
    const token = fallbackTime === secureTime ? readFallbackFile() : null;
    if (token !== null) adoptLoadedToken(generation, token, false, null);
    return;
  }

  let token: string | null = null;
  let from: StoreKind = source;
  let reEncrypt = false;
  if (source === 'secure') {
    try {
      const decrypted = await safeStorage.decryptStringAsync(fs.readFileSync(SECURE_FILE));
      token = decrypted.result;
      reEncrypt = decrypted.shouldReEncrypt;
    } catch (e: any) {
      // ENOENT: the file vanished meanwhile (a sign-out), not a decrypt failure.
      if (e?.code !== 'ENOENT') diagnostic("main.token-store", "WARNING", "token_store_secure_file_unreadable", '[token-store] secure token file cannot be decrypted', e);
      // The secure file is lost for good, so an older fallback file costs nothing to try.
      if (fallbackTime !== null) {
        token = readFallbackFile();
        from = 'fallback';
      }
    }
  } else {
    token = readFallbackFile();
  }
  if (token === null) return;

  if (from === 'secure' && process.platform !== 'win32') {
    // The previous build wrote this file without a mode; nothing may be queued
    // to rewrite it, so tighten it here.
    try { fs.chmodSync(SECURE_FILE, 0o600); } catch (e: any) {
      if (e?.code !== 'ENOENT') diagnostic("main.token-store", "WARNING", "token_store_could_not_restrict_secure_file_mode", '[token-store] could not restrict the secure token file mode', e);
    }
  }

  const otherFileExists = (from === 'secure' ? fallbackTime : secureTime) !== null;
  const needsWrite = from !== target || otherFileExists || reEncrypt;
  adoptLoadedToken(generation, token, needsWrite, needsWrite ? null : { token, kind: target });
}

function adoptLoadedToken(
  generation: number,
  token: string,
  needsWrite: boolean,
  persisted: { token: string; kind: StoreKind } | null,
): void {
  // A saveTokens or clearTokens during the load already set newer state.
  if (generation !== _persistGeneration) return;
  _refreshToken = token;
  _lastPersisted = persisted;
  if (needsWrite) enqueuePersist(token, generation);
}

// ── Write queue ─────────────────────────────────────────────────────

function enqueuePersist(token: string, generation: number): void {
  _persistChain = _persistChain
    .then(() => persist(token, generation))
    .catch((e) => {
      diagnostic("main.token-store", "WARNING", "token_store_failed_to_persist_refresh_token", '[token-store] failed to persist refresh token', e);
    });
}

async function persist(token: string, generation: number): Promise<void> {
  if (generation !== _persistGeneration) return;
  const available = await secureStoreAvailable();
  const kind: StoreKind = available ? 'secure' : 'fallback';
  if (_lastPersisted?.token === token && _lastPersisted.kind === kind) return;

  const outcome = available ? await trySecureWrite(token, generation) : 'skipped';
  if (outcome === 'done') return;
  if (outcome === 'skipped') warnFallbackWrite();
  await writeStore('fallback', token, encryptToken(token), generation);
}

async function trySecureWrite(token: string, generation: number): Promise<'done' | 'write_failed' | 'skipped'> {
  let encrypted: Buffer;
  try {
    encrypted = await safeStorage.encryptStringAsync(token);
  } catch (e) {
    diagnostic("main.token-store", "WARNING", "token_store_encryption_failed", '[token-store] safeStorage encryption failed', e);
    recordKeychainRefusal('encrypt_failed', e);
    return 'skipped';
  }
  try {
    await writeStore('secure', token, encrypted, generation);
    return 'done';
  } catch (e) {
    diagnostic("main.token-store", "WARNING", "token_store_secure_file_write_failed", '[token-store] could not write the secure token file', e);
    return 'write_failed';
  }
}

function warnFallbackWrite(): void {
  // A refusal marker pins the fallback for good; saying so on every token
  // rotation adds nothing.
  const pinned = keychainRefused();
  if (pinned && _warnedPinnedFallback) return;
  _warnedPinnedFallback ||= pinned;
  diagnostic("main.token-store", "WARNING", "token_store_safestorage_unavailable_using_encrypted_file_fallback", '[token-store] safeStorage unavailable — using encrypted-file fallback');
}

/** Resolves once every write queued before it settles, including writes queued
 *  while it waits, reached disk or failed. Before initTokenStore runs, writes
 *  are held, so there is nothing to wait for. */
export async function flushTokenStore(): Promise<void> {
  if (!_initPromise) return;
  let current: Promise<void>;
  do {
    current = _persistChain;
    await current;
  } while (current !== _persistChain);
}

registerQuitFlush(flushTokenStore);

// Push the new auth state to every renderer. token-store is the single
// choke point every MindsHub auth transition flows through (login,
// silent refresh, logout, invalid-grant clear), so broadcasting here —
// rather than at each call site — is what guarantees the UI can never
// silently disagree with the main process again (ENG-761). Defensive:
// callable before any window exists and under test mocks.
function broadcastAuthChanged(authenticated: boolean): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.MINDSHUB_AUTH_CHANGED, { authenticated });
    }
  } catch { /* no windows yet / test env */ }
}

export function saveTokens(accessToken: string, expiresInSeconds: number, refreshToken: string): void {
  _tokenStoreVersion += 1;
  _accessToken = accessToken;
  _expiresAt = Date.now() + expiresInSeconds * 1000;
  if (refreshToken) {
    _refreshToken = refreshToken;
    _persistGeneration += 1;
    enqueuePersist(refreshToken, _persistGeneration);
  }
  recordSignedInAccount(accessToken, refreshToken);
  // After the account, always: the organization root resolves through whichever
  // account root the call above just settled.
  recordActiveOrganization(accessToken);
  broadcastAuthChanged(true);
}

// Which account the app is signed in as, recorded HERE because this is the one
// choke point every MindsHub auth transition flows through: a sign-in that never
// reaches the finalize step still records, and the account stays nameable at
// boot with no network. Writing it here and clearing it in clearTokens keeps the
// record's lifetime equal to the session's, so "no record" and "no session" are
// one state rather than two.
function recordSignedInAccount(accessToken: string, refreshToken: string): void {
  // Both tokens come from the one exchange and name the same account, so an
  // access token this cannot read is not on its own a reason to give up the
  // session's identity. Never the STORED refresh token, which may be older
  // than this exchange and name whoever held the session before it.
  const accountId = accountIdFromToken(accessToken) ?? accountIdFromToken(refreshToken || null);
  if (!accountId) {
    // Both tokens opaque, and the session still authenticates, so the previous
    // account's record must not be left standing for it.
    diagnostic("main.token-store", "WARNING", "token_store_the_signed_in_tokens_name_no_account", '[token-store] the signed-in tokens name no account');
    quarantineSession();
    return;
  }
  try {
    writeActiveAccountSync(coworkHome(), accountId);
    // Ownership is settled HERE, beside the record, and no longer only in
    // commitMindsSignIn. A sign-in whose organization selection fails returns
    // before that function is ever reached while the session stays
    // authenticated, so a claim made only there leaves the root unclaimed for
    // an account that is already reading and writing data. This refuses a root
    // holding pre-existing data exactly as before; only when it runs changed.
    try {
      claimDefaultRoot(coworkHome(), accountId);
    } catch (claimErr) {
      diagnostic("main.token-store", "WARNING", "token_store_could_not_settle_the_account_data_root", '[token-store] could not settle the account data root', claimErr);
    }
    // The record names this session again, so an earlier held quarantine has
    // nothing left to protect against. Lifting it here rather than holding it
    // to the end of the process keeps one transient disk failure from stranding
    // the rest of the session on an empty root.
    clearInMemorySessionQuarantine();
  } catch (e) {
    diagnostic("main.token-store", "WARNING", "token_store_could_not_record_the_signed_in_account", '[token-store] could not record the signed-in account', e);
    quarantineSession();
  }
}

// NOT best-effort, and never a plain return: a record that cannot be made to
// name THIS session still names the previous account and resolves onto its
// data. Marked rather than removed, because an absent record reads as "never
// signed in", which does not always quarantine — see clearActiveAccountRecord.
function quarantineSession(): void {
  try {
    markActiveAccountUnresolved(coworkHome());
    return;
  } catch (markErr) {
    diagnostic("main.token-store", "WARNING", "token_store_could_not_mark_the_session_unresolved", '[token-store] could not mark the session unresolved', markErr);
  }
  // Disk refused, so hold it in memory instead. Without this the session keeps
  // running on whatever the file still says, and saveTokens has already kept
  // the new token and broadcast a successful sign-in, so the app is
  // authenticated as one account while root resolution selects another.
  markSessionUnresolvedInMemory();
  // The same disk just refused a write. Removing the record is weaker, and is
  // here only because a record naming somebody else is weaker still.
  try {
    clearActiveAccountRecord(coworkHome());
  } catch (removeErr) {
    diagnostic("main.token-store", "ERROR", "token_store_could_not_clear_the_signed_in_account_record_this_session_may_resolve_onto_another_accou",
      '[token-store] could not clear the signed-in account record — '
      + 'this session may resolve onto another account data root',
      removeErr,
    );
  }
}

/**
 * Which organization the session is operating as, recorded at the same choke
 * point as the account and for the same reason: every auth transition flows
 * through here, so a launch that never reaches the finalize step still records.
 * Recording only where a person picks an organization would miss every install
 * that is already signed in, which is precisely the population whose data is
 * unpartitioned.
 *
 * The claim is separate and is taken at most once per process, only when this
 * install has never recorded or claimed one. That makes the owner of existing
 * data the organization the FIRST token names, not the ranked default a boot
 * may switch to a moment later, and not the target of a switch.
 */
function recordActiveOrganization(accessToken: string): void {
  const orgId = activeOrgIdFromToken(accessToken);
  if (!orgId) return;
  const root = accountDataRoot();

  try {
    // Attempted on EVERY token that names an organization, not once per
    // process. An unclaimed root is one that EVERY organization resolves onto,
    // so leaving it unclaimed is the reported bug: a launch whose token carries
    // no organization claim, or a claim write that failed, would otherwise
    // close the only chance to write one, and every organization after it would
    // share one database. claimOrgRoot is idempotent and never steals, so
    // retrying costs nothing and repairs both cases.
    //
    // Accepted cost: when the root is unclaimed and already holds data,
    // whichever organization is active when the first claim lands inherits it.
    // Attributing that data to one organization is better than sharing it with
    // all of them, and unlike the sharing it is visible.
    if (readOrgClaim(root).kind !== 'claimed' && claimOrgRoot(root, orgId).kind !== 'claimed') {
      diagnostic("main.token-store", "ERROR", "token_store_could_not_record_which_organization_owns_this_data_root_organizations_on_this_account_ma",
        '[token-store] could not record which organization owns this data root — '
        + 'organizations on this account may share stores until it can be written',
      );
    }
    writeActiveOrgSync(root, orgId);
  } catch (e) {
    // NOT best-effort, for the same reason as the account record: a stale
    // record names the PREVIOUS organization and every check downstream
    // compares against it and agrees, so the sidecar is never moved. Removing
    // it resolves to an empty quarantine root instead, which is recoverable.
    diagnostic("main.token-store", "WARNING", "token_store_could_not_record_the_active_organization", '[token-store] could not record the active organization', e);
    try {
      writeActiveOrgSync(root, null);
    } catch (removeErr) {
      // Both writes refused, so the file still names the organization being
      // left. Hold it in memory instead, the same way the account record does:
      // saveTokens has already kept the new token and broadcast a successful
      // transition, so without this the session operates as one organization
      // while every store resolution agrees with the record and picks another.
      markOrganizationUnresolvedInMemory();
      diagnostic("main.token-store", "ERROR", "token_store_could_not_record_or_clear_the_active_organization_this_session_may_read_another_organiza",
        '[token-store] could not record OR clear the active organization — '
        + 'this session may read another organization\'s data',
        removeErr,
      );
    }
  }
}

export function getAccessToken(): string | null { return _accessToken; }

// Lets async refreshes detect that login/logout replaced their starting
// session while the network request was in flight.
export function getTokenStoreVersion(): number { return _tokenStoreVersion; }

export function isAccessTokenExpired(): boolean {
  return Date.now() > _expiresAt - 60_000; // 60s buffer
}

export function getRefreshToken(): string | null {
  if (!_initialized && _refreshToken === null && !_warnedReadBeforeInit) {
    _warnedReadBeforeInit = true;
    diagnostic("main.token-store", "WARNING", "token_store_read_before_init", '[token-store] refresh token read before the store loaded');
  }
  return _refreshToken;
}

export function clearTokens(): void {
  // The next session establishes its own identity, and a quarantine held from
  // the previous one would strand an install whose disk has since recovered.
  clearInMemorySessionQuarantine();
  _tokenStoreVersion += 1;
  _accessToken = null;
  _expiresAt = 0;
  _refreshToken = null;
  _persistGeneration += 1;
  _lastPersisted = null;
  deleteTokenFiles();
  // Same choke point, same reason: a sign-out recorded here keeps the account
  // this install was using, so it stays on its own data root rather than
  // falling back onto whichever account owns the default one.
  try {
    writeActiveAccountSync(coworkHome(), null);
  } catch (e) {
    diagnostic("main.token-store", "WARNING", "token_store_could_not_record_the_sign_out", '[token-store] could not record the sign-out', e);
  }
  broadcastAuthChanged(false);
}
