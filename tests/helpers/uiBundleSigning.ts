/* Signs page-update fixtures for unit and e2e tests, in the format the release signer writes:
   ota-manifest.json and ota-manifest.sig inside a bundle folder, and the `signed` and `signature`
   fields of latest.json. It writes the format from the shared contract directly and shares no code
   with src/main/ui-signature.ts, so a bug in the verifier cannot hide behind the same bug here. It
   lives under tests/, which tsconfig.main.json never includes, so it is never built into dist. */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

export const MANIFEST_FILE = 'ota-manifest.json';
export const SIGNATURE_FILE = 'ota-manifest.sig';

export interface TestSigningKey {
  privateKey: crypto.KeyObject;
  /** The base64 SPKI DER form that COWORK_OTA_TEST_PUBLIC_KEY and the release key file use. */
  publicKeyBase64: string;
}

/** A bundle manifest as the contract defines it. Tests that need a malformed one pass any JSON. */
export interface BundleManifestDocument {
  kind: string;
  schema: number;
  version: string;
  minServerVersion: string | null;
  files: Record<string, string>;
}

export interface SignedLatestFields {
  signed: string;
  signature: string;
}

export function generateTestSigningKey(): TestSigningKey {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, publicKeyBase64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
}

export function sha256Hex(bytes: Buffer | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** Every regular file under `dir` as a `/`-separated path, less the two manifest files at its root. */
export function listBundleFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (relativeDir: string) => {
    for (const entry of fs.readdirSync(path.join(dir, relativeDir), { withFileTypes: true })) {
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile() && relative !== MANIFEST_FILE && relative !== SIGNATURE_FILE) files.push(relative);
    }
  };
  walk('');
  return files.sort();
}

/** The manifest the signer would write for `dir` as it stands now. */
export function bundleManifestFor(dir: string, version: string, minServerVersion: string | null): BundleManifestDocument {
  const files: Record<string, string> = {};
  for (const file of listBundleFiles(dir)) files[file] = sha256Hex(fs.readFileSync(path.join(dir, file)));
  return { kind: 'cowork-ui-bundle', schema: 1, version, minServerVersion, files };
}

/** Writes `manifest` as ota-manifest.json and its signature by `key` as ota-manifest.sig. A string
 *  is written as is, so a test can sign bytes that are not valid JSON. */
export function writeSignedManifest(dir: string, manifest: BundleManifestDocument | string, key: TestSigningKey): void {
  const bytes = Buffer.from(typeof manifest === 'string' ? manifest : JSON.stringify(manifest), 'utf-8');
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), bytes);
  fs.writeFileSync(path.join(dir, SIGNATURE_FILE), `${crypto.sign(null, bytes, key.privateKey).toString('base64')}\n`);
}

/** Signs the folder as the release signer does: lists and hashes every file, then writes both files. */
export function signBundleFolder(dir: string, version: string, minServerVersion: string | null, key: TestSigningKey): BundleManifestDocument {
  const manifest = bundleManifestFor(dir, version, minServerVersion);
  writeSignedManifest(dir, manifest, key);
  return manifest;
}

/** The `signed` and `signature` fields of latest.json for any signed document. */
export function signLatestDocument(document: object, key: TestSigningKey): SignedLatestFields {
  const bytes = Buffer.from(JSON.stringify(document), 'utf-8');
  return { signed: bytes.toString('base64'), signature: crypto.sign(null, bytes, key.privateKey).toString('base64') };
}

/** The `signed` and `signature` fields of latest.json for a release. */
export function signLatest(
  release: { version: string; sha256: string; minServerVersion: string | null },
  key: TestSigningKey,
): SignedLatestFields {
  return signLatestDocument({ kind: 'cowork-ui-latest', schema: 1, ...release }, key);
}

/** The folder's contents as a gzipped tarball, made the way the release workflow makes it. */
export function tarBundleFolder(dir: string): Buffer {
  return execFileSync('tar', ['czf', '-', '-C', dir, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
}
