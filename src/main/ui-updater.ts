import { diagnostic } from '../shared/diagnostics';
import { app } from 'electron';
import { httpsGet } from './http-get';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { parseUiManifest, otaUiEnabled, otaCacheIsFresh, uiUpdateIsNewer, uiServerCompatSkipReason, type UIManifest } from './update-logic';
import {
  readSignedBundleManifest,
  readVerifiedBundleFile,
  trustedUiPublicKeys,
  verifyBundleFiles,
  verifyBundleFolder,
  verifyLatestSignature,
  type BundleFileRead,
  type BundleManifest,
  type FolderRefusal,
  type LatestRefusal,
  type SignedUiLatest,
  type UiTrustedKeys,
} from './ui-signature';
import { parseCalVer } from '../shared/version';
import { buildKindStrict, coworkHome, buildKind } from './cowork-home';
import { getAppDisplayVersion } from './server-source';
import { fetchServerVersions } from './server-process';
import { retryOnTransientLock } from './fs-retry';
import { isPackagedRun } from './launch-guard';

export type { UIManifest };

// The exact slot VERSION whose server-compat floor has been verified satisfied
// this session — either at apply time (against the just-updated server) or by
// verifyServedUiCompat() after boot. A constrained slot is served only when its
// version matches this. Tracking the version (not a global boolean) means the
// gate can't leak across a slot rotation and opens for the precise slot that
// passed. null = nothing verified yet (fail-closed: a constrained slot at boot
// serves bundled until proven compatible).
let _verifiedCompatVersion: string | null = null;

// Serialize the cache-slot shuffle. activateStaged and rollbackUI both moved
// from sync to async (retry backoff), so the current/previous/staging rename
// dance is no longer atomic w.r.t. the event loop and the two paths could
// interleave — e.g. a boot-time rollback still retrying a locked `current`
// while the update poll starts an activate on the same dirs. This promise chain
// forces every shuffle to run to completion before the next begins. A rejection
// never breaks the chain (the next op still runs).
let _swapChain: Promise<unknown> = Promise.resolve();
function serializeSwap<T>(fn: () => Promise<T>): Promise<T> {
  const run = _swapChain.then(fn, fn);
  _swapChain = run.then(() => undefined, () => undefined);
  return run;
}

/* The keys a page update may be signed with. A packaged build trusts the release key only; an
   unpackaged run (npm run dev, the e2e suites) also trusts COWORK_OTA_TEST_PUBLIC_KEY. A run
   counts as unpackaged only when isPackagedRun says so, which also needs Electron's default app
   to have loaded it: `app.isPackaged` alone is false for a copy of the signed binary renamed to
   `electron`. */
function trustedKeys(): UiTrustedKeys {
  const packaged = isPackagedRun({ isPackaged: app.isPackaged, defaultApp: process.defaultApp });
  return trustedUiPublicKeys({ isPackaged: packaged, testPublicKey: process.env.COWORK_OTA_TEST_PUBLIC_KEY });
}

/* One fixed diagnostic event per refusal, so a log line names why a bundle or a latest.json was
   refused. `cached` is the slot the window would load; `served` is the slot the window loaded,
   refused by a read through it (ui-file-protocol.ts); `downloaded` is a freshly extracted one. */
const FOLDER_REFUSAL_SLUG: Record<FolderRefusal, string> = {
  'manifest-missing': 'manifest_missing',
  'signature-missing': 'signature_missing',
  'malformed-signature': 'malformed_signature',
  'bad-signature': 'bad_signature',
  'malformed-document': 'malformed_manifest',
  'wrong-kind': 'wrong_kind',
  'unknown-schema': 'unknown_schema',
  'non-regular-entry': 'non_regular_entry',
  'missing-file': 'missing_file',
  'extra-file': 'extra_file',
  'hash-mismatch': 'hash_mismatch',
  unreadable: 'unreadable',
};

function folderRefusalEvent(slot: 'cached' | 'served' | 'downloaded', reason: FolderRefusal): string {
  return `ui_updater_${slot}_ui_refused_${FOLDER_REFUSAL_SLUG[reason]}`;
}

const LATEST_REFUSAL_EVENT: Record<LatestRefusal, string> = {
  unsigned: 'ui_updater_latest_json_unsigned_no_update',
  'malformed-signature': 'ui_updater_latest_json_malformed_signature_no_update',
  'bad-signature': 'ui_updater_latest_json_bad_signature_no_update',
  'malformed-document': 'ui_updater_latest_json_malformed_signed_fields_no_update',
  'wrong-kind': 'ui_updater_latest_json_wrong_kind_no_update',
  'unknown-schema': 'ui_updater_latest_json_unknown_schema_no_update',
};

// Whether UI OTA hot-updates run in this build. Gated by build channel + env
// (see otaUiEnabled) instead of a hardcoded constant (ENG-670): ON for prod
// releases, OFF for preview/stable (staging) and dev so testers keep the
// branch-under-test bundled UI. Resolved per-call (cheap) so an env override
// can flip it without a rebuild; fails safe to OFF if the build kind is
// unreadable.
function otaEnabled(): boolean {
  // buildKindStrict() returns null (never prod) for a missing/malformed build
  // kind, so a mispackaged build can't accidentally enable production OTA.
  let kind: string | null = null;
  try { kind = buildKindStrict(); } catch { kind = null; }
  return otaUiEnabled({ buildKind: kind, envOverride: process.env.OTA_UI });
}

// One-shot guard against a silent, feature-killing misconfiguration: OTA is
// enabled but the app-bundled version isn't CalVer (e.g. a build that shipped
// without a CalVer BUILD_APP_VERSION baked, so getAppDisplayVersion falls back
// to the package.json SemVer). The freshness gate (otaCacheIsFresh) compares the
// cache against that version, so a non-CalVer bundled version makes EVERY update
// fail the "strictly newer than bundled" check — OTA reports success but serves
// nothing, with no other signal. Warn loudly once so it's diagnosable in the
// field instead of invisible. Fires only when OTA is on (so it's prod-scoped by
// construction), from the update entry points.
let _warnedBundledNotCalVer = false;
function warnIfBundledVersionNotCalVer(): void {
  if (_warnedBundledNotCalVer) return;
  const bundled = getAppDisplayVersion();
  if (parseCalVer(bundled)) return; // healthy: a CalVer is baked
  _warnedBundledNotCalVer = true;
  diagnostic("main.ui-updater", "WARNING", "ui_updater_ota_is_enabled_but_the_bundled_app_version_is_not_calver_major_yy_m_d_seq_the_freshness_g",
    `[ui-updater] OTA is enabled but the bundled app version "${bundled}" is not CalVer ` +
    `(MAJOR.YY.M.D.SEQ) — the freshness gate will withhold EVERY update, so OTA is inert. ` +
    `Ensure a CalVer BUILD_APP_VERSION is baked at build time (see gen-build-channel.mjs).`,
  );
}

// Where we read latest.json from — GitHub Pages, no API rate limits.
const DEFAULT_MANIFEST_URL = 'https://mindsdb.github.io/antontron-releases/latest.json';

// QA / staging-dogfood seam: COWORK_OTA_MANIFEST_URL repoints the OTA client at
// a non-prod manifest host (e.g. a local fixture server), so the full
// check/apply/rollback lifecycle can be exercised without publishing to the
// real prod manifest. Never set in a shipped prod build. A plaintext http://
// override is honoured only for loopback (see httpsGet), so a leaked or tampered
// value can't silently downgrade prod OTA to a cleartext remote fetch.
function getManifestUrl(): string {
  return (process.env.COWORK_OTA_MANIFEST_URL || '').trim() || DEFAULT_MANIFEST_URL;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  applied: boolean;
  newVersion?: string;
  skippedReason?: string; // set when a bundle was withheld (e.g. server too old)
  // Set when the check itself couldn't complete (manifest unreachable/unparseable) —
  // distinct from a completed check that found no update. See checkForUIUpdate.
  error?: boolean;
}

/** The folder that holds the page-update slots (`current`, `previous`, `staging`). */
export function getCacheDir(): string {
  // Isolate the OTA UI cache per non-prod channel so build kinds on one machine
  // don't clobber each other's cached bundle (they share one userData because
  // they share a productName). prod keeps the historical userData location.
  if (buildKind() !== 'prod') return path.join(coworkHome(), 'ui-cache');
  return path.join(app.getPath('userData'), 'ui-cache');
}

function getCurrentDir(): string {
  return path.join(getCacheDir(), 'current');
}

function getStagingDir(): string {
  return path.join(getCacheDir(), 'staging');
}

function getPreviousDir(): string {
  return path.join(getCacheDir(), 'previous');
}

// Marker for a version we activated and then rolled back, so the boot/poll
// path won't re-download and re-activate the same failing bundle forever.
function getRejectedFile(): string {
  return path.join(getCacheDir(), 'rejected.json');
}

/* A cache slot whose files passed the folder check against its signed manifest. */
interface VerifiedSlot {
  root: string;
  manifest: BundleManifest;
}

/* The slot the window last loaded from the cache, with the manifest the folder check verified
   right before that load; readServedUiFile reads through it. Null while the bundled renderer is
   what the window loaded. A refusal that deletes the slot, a rollback, and an activation that
   moves the slot's folder clear it too, until the next load records a slot. */
let _served: VerifiedSlot | null = null;

/* How many times setServed has run. activateStaged compares it across a swap, so a swap that fails
   and puts its slot back restores the served state only when nothing else set it meanwhile. */
let _servedSets = 0;

/* Every change to the served state goes through here. */
function setServed(slot: VerifiedSlot | null): void {
  _served = slot;
  _servedSets += 1;
}

/* True unless lstat says the slot is absent. Any other error counts as present, so the folder
   check runs and reports the slot as unreadable rather than as missing. */
function slotPresent(dir: string): boolean {
  try {
    fs.lstatSync(dir);
    return true;
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? err.code : undefined;
    return code !== 'ENOENT' && code !== 'ENOTDIR';
  }
}

/* The signed manifest of the `current` slot, checked for its signature but without hashing the
   files. Enough to know which version the slot holds (the newer-than, quarantine and server-floor
   decisions), never enough to serve it: checkServableSlot does the full check for that. */
function readCurrentSignedManifest(): BundleManifest | null {
  const root = getCurrentDir();
  if (!slotPresent(root)) return null;
  const signed = readSignedBundleManifest(root, trustedKeys());
  return signed.ok ? signed.manifest : null;
}

/* Logs why the cached slot was refused and deletes it, so the next update check downloads a clean
   bundle. Deleting the slot the window loaded also clears the served state, so nothing is read
   through it any more and the next load serves the bundled renderer. A slot the check could not
   read stays: that says nothing about its contents. */
function refuseCachedSlot(root: string, reason: FolderRefusal, slot: 'cached' | 'served' = 'cached'): null {
  diagnostic("main.ui-updater", "WARNING", folderRefusalEvent(slot, reason));
  if (reason === 'unreadable') return null;
  if (_served?.root === root) setServed(null);
  try {
    rmDir(root);
  } catch (err) {
    diagnostic("main.ui-updater", "ERROR", "ui_updater_refused_cache_slot_could_not_be_deleted", err);
  }
  return null;
}

/* The marker a shell from before signed page updates writes into each slot it activates. A
   signed manifest never lists it, so the folder check would refuse such a slot as tampered. */
const OLD_SHELL_MARKER = '.ota-meta.json';

/* Removes an older shell's marker from a slot whose signature passed, so the folder check sees the
   signed files only. It removes a regular file at the slot root, and only when the manifest does
   not list that name. Anything else under that name stays, for the folder check to refuse. */
function removeOldShellMarker(root: string, manifest: BundleManifest): void {
  if (manifest.files.has(OLD_SHELL_MARKER)) return;
  const marker = path.join(root, OLD_SHELL_MARKER);
  try {
    if (!fs.lstatSync(marker).isFile()) return;
    fs.unlinkSync(marker);
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? err.code : undefined;
    if (code === 'ENOENT') return;
    diagnostic("main.ui-updater", "WARNING", "ui_updater_old_shell_marker_not_removed", err);
  }
}

/* Whether a bundle with this verified manifest may be served now: it has an index.html, it is
   newer than the bundled renderer, and a declared server floor has been verified for this exact
   version this session. */
function manifestIsServable(manifest: BundleManifest): boolean {
  if (!manifest.files.has('index.html')) return false;
  if (!otaCacheIsFresh(manifest.version, getAppDisplayVersion())) return false;
  // Fail closed: a cache with a server-compat floor is served only once THIS
  // version has been verified against the running server (at apply time or by
  // verifyServedUiCompat). At boot the server may not be up yet, so a
  // constrained cache serves bundled until proven safe.
  if (manifest.minServerVersion && _verifiedCompatVersion !== manifest.version) return false;
  return true;
}

/* The `current` slot when it may be served right now, else null. Every call checks the signed
   manifest, removes an older shell's marker from a slot whose signature passed, checks the gates
   above, and then, for a slot it would serve, walks the folder and hashes every file; nothing is
   cached between calls. A slot that fails the signature or the files is deleted. Synchronous,
   because the window's loads in app.ts are; the file hashing is nearly all of its cost. */
function checkServableSlot(): VerifiedSlot | null {
  if (!otaEnabled()) return null;
  const root = getCurrentDir();
  if (!slotPresent(root)) return null;
  const signed = readSignedBundleManifest(root, trustedKeys());
  if (!signed.ok) return refuseCachedSlot(root, signed.reason);
  removeOldShellMarker(root, signed.manifest);
  if (!manifestIsServable(signed.manifest)) return null;
  const files = verifyBundleFiles(root, signed.manifest);
  if (!files.ok) return refuseCachedSlot(root, files.reason);
  return { root, manifest: signed.manifest };
}

function getRejectedVersion(): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(getRejectedFile(), 'utf-8'));
    return typeof data?.version === 'string' && data.version ? data.version : null;
  } catch {
    return null;
  }
}

function recordRejectedVersion(version: string): void {
  try {
    fs.mkdirSync(getCacheDir(), { recursive: true });
    fs.writeFileSync(getRejectedFile(), JSON.stringify({ version }), 'utf-8');
  } catch { /* best-effort — a re-activation loop is the only downside */ }
}

function clearRejectedVersion(): void {
  try { fs.unlinkSync(getRejectedFile()); } catch { /* already absent */ }
}

function getBundledRendererPath(): string {
  // In packaged app: process.resourcesPath/app/dist/renderer/index.html
  // In dev: dist/renderer/index.html relative to main
  return path.join(__dirname, '..', '..', 'renderer', 'index.html');
}

/** What the window loads next: the activated OTA bundle, or the app-bundled renderer. */
export type RendererLoad =
  | { kind: 'ota'; path: string; version: string }
  | { kind: 'bundled'; path: string };

/** Decides what the window loads next and records the decision for
 *  readServedUiFile. The OTA bundle is served only when ALL hold: OTA is
 *  enabled for this build channel; the `current` slot passes the folder check
 *  run now (signed manifest, exact file set, every hash); its signed version is
 *  newer than the app-bundled renderer (so a fresh install or a shell upgrade
 *  can never downgrade the UI); and a declared server floor is verified.
 *  Otherwise the always-safe bundled renderer. Call it right before each load. */
export function resolveRendererLoad(): RendererLoad {
  const slot = checkServableSlot();
  if (!slot) return resolveBundledRendererLoad();
  setServed(slot);
  return { kind: 'ota', path: path.join(slot.root, 'index.html'), version: slot.manifest.version };
}

/** Records that the window loads the app-bundled renderer next, ignoring any
 *  OTA cache, and returns that load. Every load of the bundled renderer goes
 *  through here or through resolveRendererLoad, so the served state never
 *  names a cache slot while the bundled renderer runs. */
export function resolveBundledRendererLoad(): Extract<RendererLoad, { kind: 'bundled' }> {
  setServed(null);
  return { kind: 'bundled', path: getBundledRendererPath() };
}

/** The index.html path to load next (see resolveRendererLoad). */
export function getRendererPath(): string {
  return resolveRendererLoad().path;
}

/** True when the next load would serve the activated OTA bundle. Runs the same
 *  folder check as resolveRendererLoad, without recording a load. */
export function isServingOta(): boolean {
  return checkServableSlot() !== null;
}

/** The result of readServedUiFile: the file's bytes, or why they were refused. */
export type ServedUiFileRead = BundleFileRead | { ok: false; reason: 'not-serving' };

/** Reads one file of the page update the window loaded, by its path relative
 *  to the slot. Returns the bytes only when their SHA-256 matches the manifest
 *  that was verified right before that load and is held in memory, so a
 *  manifest rewritten on disk afterwards changes nothing. Refuses everything
 *  while the bundled renderer is loaded. */
export function readServedUiFile(relativePath: string): ServedUiFileRead {
  if (!_served) return { ok: false, reason: 'not-serving' };
  return readVerifiedBundleFile(_served.root, _served.manifest, relativePath);
}

/** The folder of the slot the window loaded, or null while the bundled
 *  renderer is what the window loaded. readServedUiFile reads under it. */
export function servedUiRoot(): string | null {
  return _served?.root ?? null;
}

/** The readServedUiFile refusals that mean a file of the served slot changed
 *  on disk after the folder check that ran before the load. */
export type ServedSlotChange = 'hash-mismatch' | 'non-regular-entry' | 'missing-file';

/** Refuses the slot the window loaded after a read through it found a file
 *  changed on disk: logs why, deletes the slot and clears the served state,
 *  so the next load serves the bundled renderer and the next update check
 *  downloads a clean bundle. Does nothing while the bundled renderer is loaded. */
export function refuseServedUiSlot(reason: ServedSlotChange): void {
  if (!_served) return;
  refuseCachedSlot(_served.root, reason, 'served');
}

/** The version of the page update the window last loaded, from the manifest
 *  the folder check verified right before that load, or null while the
 *  bundled renderer is what the window loaded. It reads that record only: it
 *  hashes nothing and deletes nothing, so asking what runs (About, Settings,
 *  Copy Diagnostics) never touches the slot the window runs from. */
export function getCachedVersion(): string | null {
  return _served?.manifest.version ?? null;
}

/** The signed version of the activated slot, `current`, with its signature
 *  checked and its files neither hashed nor deleted; null when there is no
 *  slot or its signature fails. An update record names it as the version the
 *  update moves to; the version the window runs is getCachedVersion. */
export function activatedUiVersion(): string | null {
  return readCurrentSignedManifest()?.version ?? null;
}

/** Quick connectivity check — can we reach the manifest host? */
export async function hasInternet(): Promise<boolean> {
  try {
    const res = await httpsGet(getManifestUrl(), 5000);
    return res.statusCode === 200;
  } catch {
    return false;
  }
}

/** latest.json as published, unverified. Only the unsigned, advisory
 *  `shellVersion` is read from it directly; a UI update goes through
 *  fetchVerifiedRelease. */
export async function fetchManifest(): Promise<UIManifest | null> {
  try {
    const res = await httpsGet(getManifestUrl());
    if (res.statusCode !== 200) return null;
    return parseUiManifest(res.body.toString('utf-8'));
  } catch {
    return null;
  }
}

/* The release latest.json offers: its signed fields, plus the unsigned download URL (the signed
   hash covers what it points to). */
interface VerifiedUiRelease extends SignedUiLatest {
  url: string;
}

type ReleaseFetch = { ok: true; release: VerifiedUiRelease } | { ok: false; reason: 'unreachable' | LatestRefusal };

/* latest.json with its signature verified. A manifest that could not be fetched or parsed is
   'unreachable'; one whose signed fields are missing or do not verify offers no update and logs
   why. */
async function fetchVerifiedRelease(): Promise<ReleaseFetch> {
  const manifest = await fetchManifest();
  if (!manifest) return { ok: false, reason: 'unreachable' };
  const check = verifyLatestSignature(manifest, trustedKeys());
  if (!check.ok) {
    diagnostic("main.ui-updater", "WARNING", LATEST_REFUSAL_EVENT[check.reason]);
    return check;
  }
  return { ok: true, release: { ...check.latest, url: manifest.url } };
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/* Removes a slot, or a symlink standing where a slot should be (rmSync removes the link, not
   its target). `force` makes an absent path a no-op. */
function rmDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Download caps: per-socket inactivity vs. absolute wall-clock (bounds a
// trickle-fed download); tar cap force-kills a wedged extraction (ENG-749).
const UI_DOWNLOAD_INACTIVITY_MS = 60_000;
const UI_DOWNLOAD_DEADLINE_MS = 300_000;
const TAR_EXTRACT_TIMEOUT_MS = 60_000;

/** Extracts a .tar.gz buffer into a target directory. Bounded so a wedged tar
 *  can't hang the caller; throws on failure/timeout. Exported for tests. */
export async function extractTarGz(buf: Buffer, targetDir: string): Promise<void> {
  fs.mkdirSync(targetDir, { recursive: true });
  const tmpFile = path.join(getCacheDir(), 'download.tar.gz');
  fs.writeFileSync(tmpFile, buf);
  const { execFileSync } = require('child_process');
  try {
    execFileSync('tar', ['xzf', tmpFile, '-C', targetDir], {
      timeout: TAR_EXTRACT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
  }
}

/** Download, verify, and stage a new UI bundle. Returns true on success. The
 *  tarball must hash to the signed sha256 before it is extracted; the extracted
 *  folder must then pass the folder check and carry the signed version and
 *  server floor. Any failure deletes the staging slot. */
async function downloadAndStage(release: VerifiedUiRelease): Promise<boolean> {
  diagnostic("main.ui-updater", "INFO", "ui_updater_downloading_ui", `[ui-updater] downloading UI ${release.version}...`);
  const res = await httpsGet(release.url, UI_DOWNLOAD_INACTIVITY_MS, UI_DOWNLOAD_DEADLINE_MS);
  if (res.statusCode !== 200) {
    diagnostic("main.ui-updater", "ERROR", "ui_updater_download_failed_http", { status: res.statusCode });
    return false;
  }

  const hash = sha256(res.body);
  if (hash !== release.sha256) {
    diagnostic("main.ui-updater", "ERROR", "ui_updater_sha_256_mismatch_expected_got", `[ui-updater] SHA-256 mismatch: expected ${release.sha256}, got ${hash}`);
    return false;
  }

  const staging = getStagingDir();
  rmDir(staging);
  try {
    await extractTarGz(res.body, staging);
  } catch (err) {
    diagnostic("main.ui-updater", "ERROR", "ui_updater_extraction_failed", '[ui-updater] extraction failed:', err);
    rmDir(staging);
    return false;
  }

  const check = verifyBundleFolder(staging, trustedKeys());
  if (!check.ok) {
    diagnostic("main.ui-updater", "ERROR", folderRefusalEvent('downloaded', check.reason));
    rmDir(staging);
    return false;
  }
  if (check.manifest.version !== release.version || check.manifest.minServerVersion !== release.minServerVersion) {
    diagnostic("main.ui-updater", "ERROR", "ui_updater_downloaded_ui_refused_manifest_differs_from_signed_release");
    rmDir(staging);
    return false;
  }
  if (!check.manifest.files.has('index.html')) {
    diagnostic("main.ui-updater", "ERROR", "ui_updater_extracted_bundle_missing_index_html", '[ui-updater] extracted bundle missing index.html');
    rmDir(staging);
    return false;
  }

  return true;
}

/** Activate a staged bundle: current → previous, staging → current.
 *  The rm/rename steps race Windows locks (renderer/AV holding a file), so each
 *  retries. And the swap is multi-step: if `staging → current` fails after
 *  `current` was moved aside, the app would be left with NO active slot — so on
 *  a mid-swap failure we put `current` back before rethrowing. The slot's signed
 *  manifest travels with it, and nothing else is written into it: the folder
 *  check refuses any file the manifest does not list.
 *
 *  Reads through the served slot stop before its folder first moves: from then
 *  on `current` is missing or holds the new bundle, whose files the manifest
 *  verified at the last load does not describe. A lazy load in the page gets a
 *  404 and deletes nothing, where a read that found the folder moved would
 *  refuse the slot as tampered. A swap that fails and leaves the old slot in
 *  `current` restores the served state, so the page keeps its lazy loads,
 *  unless a load, a rollback or a refusal set the served state meanwhile. */
async function activateStaged(version: string): Promise<void> {
  const current = getCurrentDir();
  const previous = getPreviousDir();
  const staging = getStagingDir();

  await retryOnTransientLock(() => rmDir(previous));
  const served = _served;
  setServed(null);
  const setsAtClear = _servedSets;
  const restoreServed = () => {
    if (_servedSets === setsAtClear) setServed(served);
  };
  const movedCurrent = fs.existsSync(current);
  if (movedCurrent) {
    try {
      await retryOnTransientLock(() => fs.renameSync(current, previous));
    } catch (err) {
      // Nothing moved, so the served slot is still in `current`.
      restoreServed();
      throw err;
    }
  }
  try {
    await retryOnTransientLock(() => fs.renameSync(staging, current));
  } catch (err) {
    // Torn swap: restore the bundle we moved aside so `current` isn't left
    // empty. Retry this too: a transient lock on `previous` must not be what
    // leaves the app with no slot.
    if (movedCurrent && !fs.existsSync(current)) {
      try {
        await retryOnTransientLock(() => fs.renameSync(previous, current));
        restoreServed();
      } catch { /* best-effort recovery */ }
    }
    throw err;
  }
  diagnostic("main.ui-updater", "INFO", "ui_updater_activated_ui", `[ui-updater] activated UI ${version}`);
}

/** Reason to withhold this UI bundle for server-compat, or null if OK to apply.
 *  A safety net on top of the server-first update coupling: reads the running
 *  server version once from /health and delegates the (CalVer) decision to the
 *  pure helper. No constraint / unknown server never blocks. */
async function serverCompatSkip(release: VerifiedUiRelease): Promise<string | null> {
  if (!release.minServerVersion) return null;
  const { server } = await fetchServerVersions().catch(() => ({ server: null }));
  const reason = uiServerCompatSkipReason({ minServerVersion: release.minServerVersion, serverVersion: server });
  if (reason) diagnostic("main.ui-updater", "INFO", "ui_updater_withholding_ui", `[ui-updater] withholding UI ${release.version}: ${reason}`);
  return reason;
}

/**
 * Check for UI updates. If a new version is available, downloads and
 * stages it but does NOT activate (caller decides when to activate).
 */
export async function checkForUIUpdate(): Promise<UpdateCheckResult> {
  if (!otaEnabled()) {
    diagnostic("main.ui-updater", "INFO", "ui_updater_ota_ui_disabled_for_this_build_channel", '[ui-updater] OTA UI disabled for this build channel');
    return { updateAvailable: false, applied: false };
  }
  warnIfBundledVersionNotCalVer();
  const fetched = await fetchVerifiedRelease();
  // fetchManifest() swallows its own network/parse errors to null — that's a
  // genuine "couldn't check" (error: true), not the same as a manifest that
  // was fetched and simply isn't newer. A manifest whose signature is missing
  // or does not verify is a completed check that offers no update.
  if (!fetched.ok) {
    return fetched.reason === 'unreachable'
      ? { updateAvailable: false, applied: false, error: true }
      : { updateAvailable: false, applied: false };
  }
  const { release } = fetched;

  // Quarantine: a version we activated and rolled back stays skipped until the
  // manifest advances to a different version — otherwise every auto-update boot
  // re-downloads, re-activates, and re-fails the same bundle.
  const rejected = getRejectedVersion();
  if (rejected === release.version) {
    diagnostic("main.ui-updater", "INFO", "ui_updater_skipping_quarantined_after_a_failed_activation", `[ui-updater] skipping ${release.version} — quarantined after a failed activation`);
    return { updateAvailable: false, applied: false };
  }
  if (rejected) clearRejectedVersion(); // manifest moved on — retry allowed

  // Announce only a bundle strictly newer than the effective installed UI (the
  // newest of the app-bundled renderer and the current cache's signed version).
  // This stops a fresh install re-downloading the version it already ships,
  // and blocks a regressed manifest from downgrading a newer cache.
  if (!uiUpdateIsNewer(release.version, getAppDisplayVersion(), readCurrentSignedManifest()?.version ?? null)) {
    return { updateAvailable: false, applied: false };
  }

  const skippedReason = await serverCompatSkip(release);
  if (skippedReason) return { updateAvailable: false, applied: false, skippedReason };

  return { updateAvailable: true, applied: false, newVersion: release.version };
}

/**
 * Download, verify, stage, and activate a UI update in one shot.
 * Returns true if the update was applied successfully.
 *
 * Single-flighted: both the manual apply (UI_UPDATE_APPLY) and the boot/poll
 * reach here, and downloadAndStage's `rmDir(staging)` + extract runs outside the
 * swap chain — so without this two runs could overlap on the staging dir (one
 * extracting while the other renames staging→current). Concurrent callers share
 * the one in-flight run.
 */
let _applyInFlight: Promise<boolean> | null = null;
// The manifest version the last apply downloaded, or null when it stopped
// before downloading (no manifest, quarantined, not newer, held for server
// compat). Read-only observability: the orchestrator credits a failed apply
// to the version it actually tried, which can differ from the one the earlier
// check offered when a release publishes in between.
let _lastAttemptedVersion: string | null = null;

/** The version the last `applyUIUpdate` run tried to install, or null if it
 *  stopped before downloading anything. */
export function lastUiApplyAttempt(): string | null {
  return _lastAttemptedVersion;
}

export function applyUIUpdate(): Promise<boolean> {
  if (_applyInFlight) return _applyInFlight;
  _applyInFlight = runApplyUIUpdate().finally(() => { _applyInFlight = null; });
  return _applyInFlight;
}

async function runApplyUIUpdate(): Promise<boolean> {
  _lastAttemptedVersion = null;
  if (!otaEnabled()) return false;
  warnIfBundledVersionNotCalVer();
  const fetched = await fetchVerifiedRelease();
  if (!fetched.ok) return false;
  const { release } = fetched;

  const rejected = getRejectedVersion();
  if (rejected === release.version) return false; // quarantined (see checkForUIUpdate)
  if (rejected) clearRejectedVersion();

  // Only apply a bundle strictly newer than the effective installed UI (never
  // re-activate the shipped version or downgrade a newer cache).
  if (!uiUpdateIsNewer(release.version, getAppDisplayVersion(), readCurrentSignedManifest()?.version ?? null)) return false;

  // Defense in depth: re-check compat at apply time (the manual apply path
  // forces a UI apply without a fresh checkForUIUpdate).
  if (await serverCompatSkip(release)) return false;

  _lastAttemptedVersion = release.version;
  const ok = await downloadAndStage(release);
  if (!ok) return false;

  // If the swap fails after retries it has already restored the prior slot, so
  // treat it as "no update this pass" rather than propagating a torn reload.
  try {
    await serializeSwap(() => activateStaged(release.version));
  } catch (err) {
    diagnostic("main.ui-updater", "ERROR", "ui_updater_activation_failed_kept_the_existing_ui_slot", '[ui-updater] activation failed — kept the existing UI slot', err);
    return false;
  }

  // Open the serve-gate for this (compat-verified) slot only on success —
  // otherwise the reload right after activation falls back to bundled and
  // "succeeds" without ever loading the new bundle.
  _verifiedCompatVersion = release.version;
  return true;
}

/** Roll back the active OTA bundle: quarantine the version we're leaving (so it
 *  isn't re-activated), restore the previous slot if there is one, else fall
 *  through to the bundled renderer. Each slot carries its signed manifest, so
 *  the next load serves the restored slot once it passes the folder check.
 *  The quarantine is recorded synchronously (before the first await), so
 *  a fire-and-forget caller is safe; the rm/rename retry the same Windows locks
 *  activateStaged guards. */
export async function rollbackUI(): Promise<void> {
  const current = getCurrentDir();
  const previous = getPreviousDir();

  const failed = readCurrentSignedManifest()?.version ?? null;
  if (failed) recordRejectedVersion(failed);
  // The window is leaving the slot, so nothing may be read through it any more.
  setServed(null);

  // Quarantine above stays synchronous (before the first await) so a
  // fire-and-forget caller can't re-activate the bad version; the slot shuffle
  // runs through the shared chain so it can't interleave with an activate.
  await serializeSwap(async () => {
    await retryOnTransientLock(() => rmDir(current));
    if (fs.existsSync(previous)) {
      await retryOnTransientLock(() => fs.renameSync(previous, current));
    }
  });
}

/** Re-verify the currently-active OTA slot against the running server and open
 *  the serve-gate for its version if compatible. Called AFTER the updater's
 *  server-update/recovery pass, so a server that needed upgrading to satisfy the
 *  floor has already been brought current.
 *
 *  Never rolls back or quarantines here: an incompatible or unverifiable slot is
 *  merely *deferred* (bundled wins this session, the slot is kept intact) — a
 *  transient old/down server must not permanently reject an otherwise-valid
 *  cache. Quarantine is reserved for an actual renderer-load failure.
 *   - 'none'     — OTA off or no valid slot
 *   - 'verified' — slot satisfies the floor; gate opened for its version
 *   - 'deferred' — incompatible or unverifiable; serve bundled, keep the slot */
export async function verifyServedUiCompat(): Promise<'none' | 'verified' | 'deferred'> {
  if (!otaEnabled()) return 'none';
  // The floor comes from the slot's signed manifest; the load that follows a
  // 'verified' runs the full folder check before serving it.
  const manifest = readCurrentSignedManifest();
  if (!manifest) return 'none';
  if (!manifest.minServerVersion) { _verifiedCompatVersion = manifest.version; return 'verified'; }
  const { server } = await fetchServerVersions().catch(() => ({ server: null }));
  const reason = uiServerCompatSkipReason({ minServerVersion: manifest.minServerVersion, serverVersion: server });
  if (!reason) { _verifiedCompatVersion = manifest.version; return 'verified'; }
  diagnostic("main.ui-updater", "WARNING", "ui_updater_active_ota_cache_not_served_this_session", `[ui-updater] active OTA cache not served this session: ${reason}`);
  return 'deferred';
}
