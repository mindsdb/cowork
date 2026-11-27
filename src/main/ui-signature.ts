/* Verifies signed page updates: the signed fields of latest.json, the signed manifest inside a
   bundle folder, the folder's files against that manifest, and single files read through a
   manifest that was verified earlier. Node built-ins only, and no electron, so the release
   cross-check can import it outside the app. Every function returns a tagged result that names
   why it refused; none of them throws for a bad bundle. */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RELEASE_UI_PUBLIC_KEY } from './ui-release-public-key';

/* The two files the signer adds at the bundle root. The folder check leaves them out of the
   file list it compares with the manifest. */
export const BUNDLE_MANIFEST_FILE = 'ota-manifest.json';
export const BUNDLE_SIGNATURE_FILE = 'ota-manifest.sig';

const BUNDLE_KIND = 'cowork-ui-bundle';
const LATEST_KIND = 'cowork-ui-latest';
const SUPPORTED_SCHEMA = 1;
const ED25519_SIGNATURE_BYTES = 64;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ASCII_WHITESPACE_AT_EDGES = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;
const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0;

export type UiTrustedKeys = readonly crypto.KeyObject[];

export interface TrustedKeySources {
  /** Whether this is a packaged run (the app passes isPackagedRun from launch-guard.ts). A
   *  packaged run trusts the release key only. */
  isPackaged: boolean;
  /** `COWORK_OTA_TEST_PUBLIC_KEY`, read only when the build is not packaged. */
  testPublicKey: string | undefined;
}

/** What `latest.json` signs: the fields a new shell uses in place of the unsigned ones. */
export interface SignedUiLatest {
  version: string;
  sha256: string;
  minServerVersion: string | null;
}

/** The signed `ota-manifest.json` of a bundle folder. `files` maps each path to its SHA-256. */
export interface BundleManifest {
  version: string;
  minServerVersion: string | null;
  files: ReadonlyMap<string, string>;
}

type SignedDocumentRefusal =
  | 'malformed-signature'
  | 'bad-signature'
  | 'malformed-document'
  | 'wrong-kind'
  | 'unknown-schema';

export type LatestRefusal = 'unsigned' | SignedDocumentRefusal;

export type ManifestRefusal =
  | 'manifest-missing'
  | 'signature-missing'
  | 'non-regular-entry'
  | 'unreadable'
  | SignedDocumentRefusal;

export type FilesRefusal = 'non-regular-entry' | 'missing-file' | 'extra-file' | 'hash-mismatch' | 'unreadable';

export type FolderRefusal = ManifestRefusal | FilesRefusal;

export type BundleFileRefusal = 'unsafe-path' | 'not-in-manifest' | 'non-regular-entry' | 'missing-file' | 'hash-mismatch' | 'unreadable';

export type LatestCheck = { ok: true; latest: SignedUiLatest } | { ok: false; reason: LatestRefusal };
export type ManifestCheck = { ok: true; manifest: BundleManifest } | { ok: false; reason: ManifestRefusal };
/** `entry` names the bundle path that failed, when one path did. */
export type FilesCheck = { ok: true } | { ok: false; reason: FilesRefusal; entry?: string };
export type FolderCheck = { ok: true; manifest: BundleManifest } | { ok: false; reason: FolderRefusal; entry?: string };
export type BundleFileRead = { ok: true; bytes: Buffer } | { ok: false; reason: BundleFileRefusal };

/** Parses a public key given as the base64 of its SPKI DER encoding. Null unless it is Ed25519. */
export function parseUiPublicKey(base64Spki: string): crypto.KeyObject | null {
  const der = decodeBase64(base64Spki.trim());
  if (!der || der.length === 0) return null;
  try {
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    return null;
  }
}

/** The keys a page update may be signed with: the release key always, plus the test key only
 *  when the build is not packaged. A test key that does not parse adds nothing. */
export function trustedUiPublicKeys(sources: TrustedKeySources): UiTrustedKeys {
  const keys: crypto.KeyObject[] = [];
  const release = parseUiPublicKey(RELEASE_UI_PUBLIC_KEY);
  if (release) keys.push(release);
  if (!sources.isPackaged && sources.testPublicKey) {
    const test = parseUiPublicKey(sources.testPublicKey);
    if (test) keys.push(test);
  }
  return keys;
}

/** Verifies the `signed` and `signature` fields of latest.json and returns the signed release. */
export function verifyLatestSignature(
  fields: { signed?: string; signature?: string },
  keys: UiTrustedKeys,
): LatestCheck {
  if (!fields.signed || !fields.signature) return { ok: false, reason: 'unsigned' };
  const payload = decodeBase64(fields.signed);
  const signature = decodeBase64(fields.signature);
  if (!payload || payload.length === 0 || !signature || signature.length !== ED25519_SIGNATURE_BYTES) {
    return { ok: false, reason: 'malformed-signature' };
  }
  if (!signedByAny(payload, signature, keys)) return { ok: false, reason: 'bad-signature' };
  const parsed = parseSignedDocument(payload, LATEST_KIND);
  if (!parsed.ok) return parsed;
  const doc = parsed.document;
  const minServerVersion = readFloor(doc);
  if (!isNonEmptyString(doc.version) || typeof doc.sha256 !== 'string' || !SHA256_HEX.test(doc.sha256) || minServerVersion === undefined) {
    return { ok: false, reason: 'malformed-document' };
  }
  return { ok: true, latest: { version: doc.version, sha256: doc.sha256, minServerVersion } };
}

/** Reads `ota-manifest.json` and `ota-manifest.sig` from a bundle folder and verifies the
 *  signature, kind and schema. It does not look at the other files: verifyBundleFiles does. */
export function readSignedBundleManifest(root: string, keys: UiTrustedKeys): ManifestCheck {
  const rootRefusal = checkRealDirectory(root);
  if (rootRefusal) return { ok: false, reason: rootRefusal === 'missing' ? 'manifest-missing' : rootRefusal };
  const manifestRead = readRegularFile(path.join(root, BUNDLE_MANIFEST_FILE));
  if (!manifestRead.ok) return { ok: false, reason: manifestRead.reason === 'missing' ? 'manifest-missing' : manifestRead.reason };
  const signatureRead = readRegularFile(path.join(root, BUNDLE_SIGNATURE_FILE));
  if (!signatureRead.ok) return { ok: false, reason: signatureRead.reason === 'missing' ? 'signature-missing' : signatureRead.reason };

  const signature = decodeBase64(signatureRead.bytes.toString('latin1').replace(ASCII_WHITESPACE_AT_EDGES, ''));
  if (!signature || signature.length !== ED25519_SIGNATURE_BYTES) return { ok: false, reason: 'malformed-signature' };
  if (!signedByAny(manifestRead.bytes, signature, keys)) return { ok: false, reason: 'bad-signature' };

  const parsed = parseSignedDocument(manifestRead.bytes, BUNDLE_KIND);
  if (!parsed.ok) return parsed;
  const doc = parsed.document;
  const minServerVersion = readFloor(doc);
  const files = readFileTable(doc.files);
  if (!isNonEmptyString(doc.version) || minServerVersion === undefined || !files) {
    return { ok: false, reason: 'malformed-document' };
  }
  return { ok: true, manifest: { version: doc.version, minServerVersion, files } };
}

/** Checks a bundle folder's files against a manifest that was already verified: the regular files
 *  in the folder, less the two manifest files at its root, are exactly the manifest's paths, each
 *  hashes to its entry, and the folder holds nothing but regular files and directories. */
export function verifyBundleFiles(root: string, manifest: BundleManifest): FilesCheck {
  const rootRefusal = checkRealDirectory(root);
  if (rootRefusal) return { ok: false, reason: asFileRefusal(rootRefusal) };
  const listing = listRegularFiles(root);
  if (!listing.ok) return listing;
  const present = new Set(listing.files.filter((file) => file !== BUNDLE_MANIFEST_FILE && file !== BUNDLE_SIGNATURE_FILE));
  for (const file of present) {
    if (!manifest.files.has(file)) return { ok: false, reason: 'extra-file', entry: file };
  }
  for (const file of manifest.files.keys()) {
    if (!present.has(file)) return { ok: false, reason: 'missing-file', entry: file };
  }
  for (const [file, expected] of manifest.files) {
    const read = readRegularFile(path.join(root, file));
    if (!read.ok) return { ok: false, reason: asFileRefusal(read.reason), entry: file };
    if (sha256Hex(read.bytes) !== expected) return { ok: false, reason: 'hash-mismatch', entry: file };
  }
  return { ok: true };
}

/** The whole folder check: the signed manifest, then every file against it. */
export function verifyBundleFolder(root: string, keys: UiTrustedKeys): FolderCheck {
  const signed = readSignedBundleManifest(root, keys);
  if (!signed.ok) return signed;
  const files = verifyBundleFiles(root, signed.manifest);
  if (!files.ok) return files;
  return { ok: true, manifest: signed.manifest };
}

/** Returns one file of a bundle folder, only when the SHA-256 of the bytes it read equals the
 *  entry in `manifest`, which the caller verified earlier and holds in memory. Refuses a path the
 *  manifest does not list, a path that could leave the folder, and a symlink at any step. */
export function readVerifiedBundleFile(root: string, manifest: BundleManifest, relativePath: string): BundleFileRead {
  if (!isSafeRequestPath(relativePath)) return { ok: false, reason: 'unsafe-path' };
  const expected = manifest.files.get(relativePath);
  if (expected === undefined) return { ok: false, reason: 'not-in-manifest' };
  const directories = [root];
  for (const segment of relativePath.split('/').slice(0, -1)) {
    directories.push(path.join(directories[directories.length - 1], segment));
  }
  for (const directory of directories) {
    const refusal = checkRealDirectory(directory);
    if (refusal) return { ok: false, reason: asFileRefusal(refusal) };
  }
  const read = readRegularFile(path.join(root, relativePath));
  if (!read.ok) return { ok: false, reason: asFileRefusal(read.reason) };
  if (sha256Hex(read.bytes) !== expected) return { ok: false, reason: 'hash-mismatch' };
  return { ok: true, bytes: read.bytes };
}

/** A manifest path as the format defines it: relative, `/`-separated (so no backslash), with no
 *  leading `/` and no empty, `.` or `..` segment. */
export function isSafeBundlePath(candidate: string): boolean {
  if (candidate.length === 0 || candidate.includes('\\') || candidate.includes('\0')) return false;
  return candidate.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function isSafeRequestPath(candidate: string): boolean {
  return isSafeBundlePath(candidate) && !path.win32.isAbsolute(candidate);
}

function sha256Hex(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function decodeBase64(text: string): Buffer | null {
  return BASE64.test(text) ? Buffer.from(text, 'base64') : null;
}

function signedByAny(data: Buffer, signature: Buffer, keys: UiTrustedKeys): boolean {
  return keys.some((key) => {
    try {
      return crypto.verify(null, data, key, signature);
    } catch {
      return false;
    }
  });
}

type SignedDocument = { ok: true; document: { [field: string]: unknown } } | { ok: false; reason: SignedDocumentRefusal };

function parseSignedDocument(bytes: Buffer, kind: string): SignedDocument {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, reason: 'malformed-document' };
  }
  if (!isRecord(value)) return { ok: false, reason: 'malformed-document' };
  if (value.kind !== kind) return { ok: false, reason: 'wrong-kind' };
  if (value.schema !== SUPPORTED_SCHEMA) return { ok: false, reason: 'unknown-schema' };
  return { ok: true, document: value };
}

/* The server floor must be present: a non-empty string, or null for no floor. Undefined means
   the field is missing or malformed. */
function readFloor(doc: { [field: string]: unknown }): string | null | undefined {
  if (!Object.hasOwn(doc, 'minServerVersion')) return undefined;
  const floor = doc.minServerVersion;
  if (floor === null) return null;
  return isNonEmptyString(floor) ? floor : undefined;
}

function readFileTable(value: unknown): Map<string, string> | null {
  if (!isRecord(value)) return null;
  const files = new Map<string, string>();
  for (const [file, hash] of Object.entries(value)) {
    if (!isSafeBundlePath(file) || typeof hash !== 'string' || !SHA256_HEX.test(hash)) return null;
    files.set(file, hash);
  }
  return files;
}

function isRecord(value: unknown): value is { [field: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

type EntryRefusal = 'missing' | 'non-regular-entry' | 'unreadable';
type RegularFileRead = { ok: true; bytes: Buffer } | { ok: false; reason: EntryRefusal };

/* Opens without following a final symlink where the platform supports it, and checks the type
   with lstat first for the platforms that don't. ENOENT and ENOTDIR read as missing and ELOOP
   as a symlink; any other error reads as unreadable, never as missing. */
function readRegularFile(file: string): RegularFileRead {
  try {
    if (!fs.lstatSync(file).isFile()) return { ok: false, reason: 'non-regular-entry' };
  } catch (err) {
    return { ok: false, reason: openErrorReason(err) };
  }
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | NO_FOLLOW);
  } catch (err) {
    return { ok: false, reason: openErrorReason(err) };
  }
  try {
    if (!fs.fstatSync(fd).isFile()) return { ok: false, reason: 'non-regular-entry' };
    return { ok: true, bytes: fs.readFileSync(fd) };
  } catch {
    return { ok: false, reason: 'unreadable' };
  } finally {
    fs.closeSync(fd);
  }
}

function openErrorReason(err: unknown): EntryRefusal {
  const code = err instanceof Error && 'code' in err ? err.code : undefined;
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing';
  if (code === 'ELOOP') return 'non-regular-entry';
  return 'unreadable';
}

function asFileRefusal(reason: EntryRefusal): 'missing-file' | 'non-regular-entry' | 'unreadable' {
  return reason === 'missing' ? 'missing-file' : reason;
}

/** Null when `dir` is a directory and not a symlink. */
function checkRealDirectory(dir: string): EntryRefusal | null {
  try {
    return fs.lstatSync(dir).isDirectory() ? null : 'non-regular-entry';
  } catch (err) {
    return openErrorReason(err);
  }
}

type Listing = { ok: true; files: string[] } | { ok: false; reason: 'non-regular-entry' | 'unreadable'; entry?: string };

/* Every regular file under `root` as a `/`-separated relative path. Any entry that is neither a
   regular file nor a directory (a symlink, a socket, a device) ends the walk with a refusal. */
function listRegularFiles(root: string): Listing {
  const files: string[] = [];
  const pending: string[] = [''];
  for (let relativeDir = pending.pop(); relativeDir !== undefined; relativeDir = pending.pop()) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true });
    } catch {
      return { ok: false, reason: 'unreadable', entry: relativeDir };
    }
    for (const entry of entries) {
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) pending.push(relative);
      else if (entry.isFile()) files.push(relative);
      else return { ok: false, reason: 'non-regular-entry', entry: relative };
    }
  }
  return { ok: true, files };
}
