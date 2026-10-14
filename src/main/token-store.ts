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

// Persistence for the Keycloak refresh token.
//
// On macOS, Electron's safeStorage (Keychain) binds ACLs to the binary's
// CDHash, which changes on every build — even with the same Developer ID
// cert — causing a keychain-access prompt on every app launch. We use
// AES-256-CBC file-based storage instead (encrypted, 0600 permissions).
//
// On Windows/Linux, safeStorage (DPAPI / libsecret) doesn't prompt, so
// we keep using it there.

const IS_MAC = process.platform === 'darwin';
const KEYCHAIN_FILE = path.join(app.getPath('userData'), 'mindshub-refresh.bin');
const ENCRYPTED_FILE = path.join(coworkHome(), 'refresh-token.dat');

// ── Mac file-based encryption ───────────────────────────────────────

// Machine-local obfuscation key derived from a stable per-user path.
// This is NOT cryptographic security — it prevents casual plaintext
// exposure on disk. The real protection is file permissions (0600).
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

// ── Read / write per platform ───────────────────────────────────────

function writeEncryptedFile(refreshToken: string): void {
  fs.mkdirSync(coworkHome(), { recursive: true });
  fs.writeFileSync(ENCRYPTED_FILE, encryptToken(refreshToken), { mode: 0o600 });
}

// ENOENT is the expected case (nothing to remove); anything else means a
// stale token may survive and shadow a rotated one later — say so.
function removeStaleStore(file: string): void {
  try { fs.unlinkSync(file); } catch (e: any) {
    if (e?.code !== 'ENOENT') console.warn(`[token-store] could not remove stale token store ${file}`, e);
  }
}

function writeToken(refreshToken: string): void {
  if (IS_MAC) {
    writeEncryptedFile(refreshToken);
    // Pre-file-store builds kept the token in safeStorage under userData.
    // Inert on macOS reads, but don't leave stale credential material behind.
    removeStaleStore(KEYCHAIN_FILE);
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(KEYCHAIN_FILE, safeStorage.encryptString(refreshToken));
    // Refresh the encrypted-file copy too rather than deleting it: on
    // machines where DPAPI/libsecret flaps, the fallback is the only store
    // readable during the next outage, and keeping it fresh means a stale
    // rotated token can never shadow the real one. Best-effort — the
    // safeStorage write above already persisted the session.
    try { writeEncryptedFile(refreshToken); } catch (e) {
      console.warn('[token-store] could not refresh encrypted-file copy', e);
    }
    return;
  }
  // safeStorage unavailable (DPAPI/libsecret failure). Previously this
  // silently persisted NOTHING — the user looked signed in until the
  // next launch, then showed up as unauthenticated (ENG-761). Fall back
  // to the same encrypted file macOS uses so the session survives.
  console.warn('[token-store] safeStorage unavailable — using encrypted-file fallback');
  writeEncryptedFile(refreshToken);
  // Do not let a previously stored DPAPI token take precedence if
  // safeStorage recovers after the refresh token has rotated.
  removeStaleStore(KEYCHAIN_FILE);
}

function readToken(): string | null {
  // Mac: encrypted file
  if (IS_MAC) {
    if (!fs.existsSync(ENCRYPTED_FILE)) return null;
    return decryptToken(fs.readFileSync(ENCRYPTED_FILE));
  }
  // Windows/Linux: safeStorage, then the encrypted-file fallback written
  // when safeStorage was unavailable at save time.
  if (fs.existsSync(KEYCHAIN_FILE) && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(fs.readFileSync(KEYCHAIN_FILE));
  }
  if (fs.existsSync(ENCRYPTED_FILE)) return decryptToken(fs.readFileSync(ENCRYPTED_FILE));
  return null;
}

function deleteTokenFiles(): void {
  try { fs.unlinkSync(ENCRYPTED_FILE); } catch {}
  try { fs.unlinkSync(KEYCHAIN_FILE); } catch {}
}

// ── Public API ──────────────────────────────────────────────────────

let _accessToken: string | null = null;
let _expiresAt = 0; // epoch ms
let _tokenStoreVersion = 0;

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
    try { writeToken(refreshToken); } catch (e) {
      console.warn('[token-store] failed to persist refresh token', e);
    }
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
    console.warn('[token-store] the signed-in tokens name no account');
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
      console.warn('[token-store] could not settle the account data root', claimErr);
    }
    // The record names this session again, so an earlier held quarantine has
    // nothing left to protect against. Lifting it here rather than holding it
    // to the end of the process keeps one transient disk failure from stranding
    // the rest of the session on an empty root.
    clearInMemorySessionQuarantine();
  } catch (e) {
    console.warn('[token-store] could not record the signed-in account', e);
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
    console.warn('[token-store] could not mark the session unresolved', markErr);
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
    console.error(
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
      console.error(
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
    console.warn('[token-store] could not record the active organization', e);
    try {
      writeActiveOrgSync(root, null);
    } catch (removeErr) {
      // Both writes refused, so the file still names the organization being
      // left. Hold it in memory instead, the same way the account record does:
      // saveTokens has already kept the new token and broadcast a successful
      // transition, so without this the session operates as one organization
      // while every store resolution agrees with the record and picks another.
      markOrganizationUnresolvedInMemory();
      console.error(
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
  try {
    return readToken();
  } catch {
    return null;
  }
}

export function clearTokens(): void {
  // The next session establishes its own identity, and a quarantine held from
  // the previous one would strand an install whose disk has since recovered.
  clearInMemorySessionQuarantine();
  _tokenStoreVersion += 1;
  _accessToken = null;
  _expiresAt = 0;
  deleteTokenFiles();
  // Same choke point, same reason: a sign-out recorded here keeps the account
  // this install was using, so it stays on its own data root rather than
  // falling back onto whichever account owns the default one.
  try {
    writeActiveAccountSync(coworkHome(), null);
  } catch (e) {
    console.warn('[token-store] could not record the sign-out', e);
  }
  broadcastAuthChanged(false);
}

// Stub — the keychain toggle in settings calls this, but on macOS we no
// longer use the keychain so there is nothing to migrate. On Windows/Linux
// there is only one store (safeStorage) so migration is also a no-op.
export function migrateRefreshTokenStore(_toKeychain: boolean): void {}
