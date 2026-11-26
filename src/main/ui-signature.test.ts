import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  isSafeBundlePath,
  parseUiPublicKey,
  readSignedBundleManifest,
  readVerifiedBundleFile,
  trustedUiPublicKeys,
  verifyBundleFiles,
  verifyBundleFolder,
  verifyLatestSignature,
  type BundleManifest,
} from './ui-signature';
import { RELEASE_UI_PUBLIC_KEY } from './ui-release-public-key';
import {
  bundleManifestFor,
  generateTestSigningKey,
  signBundleFolder,
  signLatest,
  signLatestDocument,
  writeSignedManifest,
  MANIFEST_FILE,
  SIGNATURE_FILE,
} from '../../tests/helpers/uiBundleSigning';

const trusted = generateTestSigningKey();
const untrusted = generateTestSigningKey();
const KEYS = [parseUiPublicKey(trusted.publicKeyBase64)].filter((key): key is crypto.KeyObject => key !== null);
const SHA = 'ab'.repeat(32);

let dir = '';

function writeBundle(root: string): void {
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<html>bundle</html>');
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log("app");');
}

function verifiedManifest(root: string): BundleManifest {
  const check = verifyBundleFolder(root, KEYS);
  if (!check.ok) throw new Error(`fixture bundle did not verify: ${check.reason}`);
  return check.manifest;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-signature-'));
  writeBundle(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('keys', () => {
  it('ships a release key that parses as an Ed25519 public key', () => {
    expect(RELEASE_UI_PUBLIC_KEY).toMatch(/^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/);
    expect(parseUiPublicKey(RELEASE_UI_PUBLIC_KEY)?.asymmetricKeyType).toBe('ed25519');
  });

  it('refuses a key that is not Ed25519, or not base64 SPKI at all', () => {
    const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    expect(parseUiPublicKey(ec)).toBeNull();
    expect(parseUiPublicKey('not base64!')).toBeNull();
    expect(parseUiPublicKey('')).toBeNull();
    expect(parseUiPublicKey('AAAA')).toBeNull();
  });

  it('trusts the test key only when the build is not packaged', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    const packaged = trustedUiPublicKeys({ isPackaged: true, testPublicKey: trusted.publicKeyBase64 });
    const unpackaged = trustedUiPublicKeys({ isPackaged: false, testPublicKey: trusted.publicKeyBase64 });
    expect(packaged).toHaveLength(1);
    expect(unpackaged).toHaveLength(2);
    expect(verifyBundleFolder(dir, packaged)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(verifyBundleFolder(dir, unpackaged).ok).toBe(true);
  });

  it('adds nothing for a test key that does not parse, and nothing when none is set', () => {
    expect(trustedUiPublicKeys({ isPackaged: false, testPublicKey: 'garbage' })).toHaveLength(1);
    expect(trustedUiPublicKeys({ isPackaged: false, testPublicKey: undefined })).toHaveLength(1);
  });
});

describe('verifyLatestSignature', () => {
  const release = { version: '2.26.7.13.1', sha256: SHA, minServerVersion: '0.26.7.1.1' };

  it('returns the signed version, hash and floor', () => {
    expect(verifyLatestSignature(signLatest(release, trusted), KEYS)).toEqual({ ok: true, latest: release });
    const unconstrained = { ...release, minServerVersion: null };
    expect(verifyLatestSignature(signLatest(unconstrained, trusted), KEYS)).toEqual({ ok: true, latest: unconstrained });
  });

  it('offers nothing without both fields', () => {
    const fields = signLatest(release, trusted);
    expect(verifyLatestSignature({}, KEYS)).toEqual({ ok: false, reason: 'unsigned' });
    expect(verifyLatestSignature({ signed: fields.signed }, KEYS)).toEqual({ ok: false, reason: 'unsigned' });
    expect(verifyLatestSignature({ signature: fields.signature }, KEYS)).toEqual({ ok: false, reason: 'unsigned' });
  });

  it('refuses a signature by an untrusted key, and signed bytes changed after signing', () => {
    expect(verifyLatestSignature(signLatest(release, untrusted), KEYS)).toEqual({ ok: false, reason: 'bad-signature' });
    const fields = signLatest(release, trusted);
    const other = signLatest({ ...release, version: '2.26.7.14.1' }, trusted);
    expect(verifyLatestSignature({ signed: other.signed, signature: fields.signature }, KEYS)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(verifyLatestSignature(fields, [])).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses fields that are not strict base64 or not a 64-byte signature', () => {
    const fields = signLatest(release, trusted);
    expect(verifyLatestSignature({ ...fields, signed: `${fields.signed}!` }, KEYS)).toEqual({ ok: false, reason: 'malformed-signature' });
    expect(verifyLatestSignature({ ...fields, signature: 'AAAA' }, KEYS)).toEqual({ ok: false, reason: 'malformed-signature' });
    expect(verifyLatestSignature({ ...fields, signature: `${fields.signature}\n` }, KEYS)).toEqual({ ok: false, reason: 'malformed-signature' });
  });

  it('refuses another kind and an unknown schema even when the signature verifies', () => {
    expect(verifyLatestSignature(signLatestDocument({ kind: 'cowork-ui-bundle', schema: 1, ...release }, trusted), KEYS))
      .toEqual({ ok: false, reason: 'wrong-kind' });
    expect(verifyLatestSignature(signLatestDocument({ kind: 'cowork-ui-latest', schema: 2, ...release }, trusted), KEYS))
      .toEqual({ ok: false, reason: 'unknown-schema' });
    expect(verifyLatestSignature(signLatestDocument({ kind: 'cowork-ui-latest', schema: '1', ...release }, trusted), KEYS))
      .toEqual({ ok: false, reason: 'unknown-schema' });
  });

  it('refuses signed fields that are missing or malformed', () => {
    const base = { kind: 'cowork-ui-latest', schema: 1, ...release };
    const { minServerVersion: _floor, ...noFloor } = base;
    for (const doc of [
      noFloor,
      { ...base, minServerVersion: '' },
      { ...base, minServerVersion: 7 },
      { ...base, version: '' },
      { ...base, sha256: SHA.toUpperCase() },
      { ...base, sha256: 'ab' },
      [base],
    ]) {
      expect(verifyLatestSignature(signLatestDocument(doc, trusted), KEYS)).toEqual({ ok: false, reason: 'malformed-document' });
    }
    const notJson = Buffer.from('{not json');
    expect(verifyLatestSignature({ signed: notJson.toString('base64'), signature: crypto.sign(null, notJson, trusted.privateKey).toString('base64') }, KEYS))
      .toEqual({ ok: false, reason: 'malformed-document' });
  });
});

describe('the folder check', () => {
  it('accepts a folder signed by a trusted key, with a trailing newline around the signature', () => {
    const written = signBundleFolder(dir, '2.26.7.13.1', '0.26.7.1.1', trusted);
    expect(fs.readFileSync(path.join(dir, SIGNATURE_FILE), 'utf-8').endsWith('\n')).toBe(true);
    const check = verifyBundleFolder(dir, KEYS);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.manifest.version).toBe('2.26.7.13.1');
    expect(check.manifest.minServerVersion).toBe('0.26.7.1.1');
    expect(Object.fromEntries(check.manifest.files)).toEqual(written.files);
  });

  it('refuses one byte changed in a file', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    const file = path.join(dir, 'assets', 'app.js');
    const bytes = fs.readFileSync(file);
    bytes[0] ^= 1;
    fs.writeFileSync(file, bytes);
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'hash-mismatch', entry: 'assets/app.js' });
  });

  it('refuses an extra file, including one beside the manifest files at the root', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    fs.writeFileSync(path.join(dir, 'assets', 'extra.js'), 'evil()');
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'extra-file', entry: 'assets/extra.js' });
    fs.rmSync(path.join(dir, 'assets', 'extra.js'));
    fs.writeFileSync(path.join(dir, '.ota-meta.json'), '{"schema":2,"version":"2.26.7.13.1"}');
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'extra-file', entry: '.ota-meta.json' });
  });

  it('counts a nested file named like the manifest as an ordinary file', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    fs.writeFileSync(path.join(dir, 'assets', MANIFEST_FILE), '{}');
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'extra-file', entry: `assets/${MANIFEST_FILE}` });
  });

  it('refuses a removed file', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    fs.rmSync(path.join(dir, 'assets', 'app.js'));
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'missing-file', entry: 'assets/app.js' });
  });

  it('refuses a symlink in the folder, to a file or to a directory, even one the manifest lists', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    fs.symlinkSync(path.join(dir, 'index.html'), path.join(dir, 'link.html'));
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'non-regular-entry', entry: 'link.html' });
    fs.rmSync(path.join(dir, 'link.html'));

    fs.symlinkSync(os.tmpdir(), path.join(dir, 'linked-dir'));
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'non-regular-entry', entry: 'linked-dir' });
    fs.unlinkSync(path.join(dir, 'linked-dir'));

    // A symlink whose target hashes right is still refused: the type check comes first.
    const app = path.join(dir, 'assets', 'app.js');
    const outside = path.join(os.tmpdir(), `ui-signature-outside-${process.pid}.js`);
    fs.copyFileSync(app, outside);
    fs.rmSync(app);
    fs.symlinkSync(outside, app);
    try {
      expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'non-regular-entry', entry: 'assets/app.js' });
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it('refuses a slot folder that is itself a symlink', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    const link = `${dir}-link`;
    fs.symlinkSync(dir, link);
    try {
      expect(verifyBundleFolder(link, KEYS)).toEqual({ ok: false, reason: 'non-regular-entry' });
    } finally {
      fs.unlinkSync(link);
    }
  });

  it('refuses a manifest edited and re-signed with an untrusted key', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'evil()');
    signBundleFolder(dir, '2.26.7.13.1', null, untrusted);
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a manifest edited after signing', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    const manifestPath = path.join(dir, MANIFEST_FILE);
    fs.writeFileSync(manifestPath, fs.readFileSync(manifestPath, 'utf-8').replace('2.26.7.13.1', '2.26.7.99.1'));
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses an unsigned folder, such as a slot written before page updates were signed', () => {
    fs.writeFileSync(path.join(dir, '.ota-meta.json'), '{"schema":2,"version":"2.26.7.13.1"}');
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'manifest-missing' });
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    fs.rmSync(path.join(dir, SIGNATURE_FILE));
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'signature-missing' });
    expect(verifyBundleFolder(path.join(dir, 'absent'), KEYS)).toEqual({ ok: false, reason: 'manifest-missing' });
  });

  it('refuses a signature file that is not one base64 Ed25519 signature', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    fs.writeFileSync(path.join(dir, SIGNATURE_FILE), 'AAAA\n');
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'malformed-signature' });
  });

  it('refuses a manifest file or signature file that is a symlink', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-signature-elsewhere-'));
    try {
      fs.renameSync(path.join(dir, MANIFEST_FILE), path.join(elsewhere, MANIFEST_FILE));
      fs.symlinkSync(path.join(elsewhere, MANIFEST_FILE), path.join(dir, MANIFEST_FILE));
      expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'non-regular-entry' });
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('refuses another kind, an unknown schema, and a malformed manifest under a valid signature', () => {
    const good = bundleManifestFor(dir, '2.26.7.13.1', null);
    writeSignedManifest(dir, { ...good, kind: 'cowork-ui-latest' }, trusted);
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'wrong-kind' });
    writeSignedManifest(dir, { ...good, schema: 2 }, trusted);
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'unknown-schema' });
    writeSignedManifest(dir, '{oops', trusted);
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'malformed-document' });
    writeSignedManifest(dir, JSON.stringify({ ...good, version: '' }), trusted);
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'malformed-document' });
    const { minServerVersion: _floor, ...noFloor } = good;
    writeSignedManifest(dir, JSON.stringify(noFloor), trusted);
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'malformed-document' });
  });

  it('refuses a manifest path that could leave the folder, and a hash that is not lowercase hex', () => {
    const good = bundleManifestFor(dir, '2.26.7.13.1', null);
    const hash = good.files['index.html'];
    for (const bad of ['../index.html', '/index.html', './index.html', 'assets//app.js', 'assets/./app.js', 'assets\\app.js', '']) {
      writeSignedManifest(dir, { ...good, files: { ...good.files, [bad]: hash } }, trusted);
      expect(verifyBundleFolder(dir, KEYS), bad).toEqual({ ok: false, reason: 'malformed-document' });
    }
    writeSignedManifest(dir, { ...good, files: { 'index.html': hash.toUpperCase() } }, trusted);
    expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'malformed-document' });
  });

  it('reports a file it cannot read as unreadable, never as missing or valid', () => {
    if (process.getuid?.() === 0) return; // root reads a mode-000 file anyway
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    const app = path.join(dir, 'assets', 'app.js');
    fs.chmodSync(app, 0o000);
    try {
      expect(verifyBundleFolder(dir, KEYS)).toEqual({ ok: false, reason: 'unreadable', entry: 'assets/app.js' });
    } finally {
      fs.chmodSync(app, 0o644);
    }
  });

  it('checks the files against the manifest it is given, not the one on disk', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    const held = verifiedManifest(dir);
    fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'evil()');
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    expect(readSignedBundleManifest(dir, KEYS).ok).toBe(true);
    expect(verifyBundleFiles(dir, held)).toEqual({ ok: false, reason: 'hash-mismatch', entry: 'assets/app.js' });
  });
});

describe('readVerifiedBundleFile', () => {
  it('returns the bytes of a listed file whose hash matches', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    const read = readVerifiedBundleFile(dir, verifiedManifest(dir), 'assets/app.js');
    expect(read).toEqual({ ok: true, bytes: Buffer.from('console.log("app");') });
  });

  it('refuses traversal, absolute paths, backslashes and paths the manifest does not list', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    const manifest = verifiedManifest(dir);
    for (const bad of ['../index.html', 'assets/../index.html', '/etc/hosts', 'C:/Windows/win.ini', 'assets\\app.js', './index.html', '']) {
      expect(readVerifiedBundleFile(dir, manifest, bad), bad).toEqual({ ok: false, reason: 'unsafe-path' });
    }
    expect(readVerifiedBundleFile(dir, manifest, MANIFEST_FILE)).toEqual({ ok: false, reason: 'not-in-manifest' });
    expect(readVerifiedBundleFile(dir, manifest, 'assets/other.js')).toEqual({ ok: false, reason: 'not-in-manifest' });
  });

  it('refuses changed bytes, a removed file, and a symlink at the file or at a parent folder', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    const manifest = verifiedManifest(dir);
    const app = path.join(dir, 'assets', 'app.js');

    fs.writeFileSync(app, 'console.log("APP");');
    expect(readVerifiedBundleFile(dir, manifest, 'assets/app.js')).toEqual({ ok: false, reason: 'hash-mismatch' });

    fs.rmSync(app);
    expect(readVerifiedBundleFile(dir, manifest, 'assets/app.js')).toEqual({ ok: false, reason: 'missing-file' });

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-signature-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'app.js'), 'console.log("app");');
      fs.symlinkSync(path.join(outside, 'app.js'), app);
      expect(readVerifiedBundleFile(dir, manifest, 'assets/app.js')).toEqual({ ok: false, reason: 'non-regular-entry' });

      fs.rmSync(path.join(dir, 'assets'), { recursive: true });
      fs.symlinkSync(outside, path.join(dir, 'assets'));
      expect(readVerifiedBundleFile(dir, manifest, 'assets/app.js')).toEqual({ ok: false, reason: 'non-regular-entry' });
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('keeps refusing changed bytes after the manifest on disk is swapped for one that lists them', () => {
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    const held = verifiedManifest(dir);
    fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'evil()');
    signBundleFolder(dir, '2.26.7.13.1', null, trusted);
    expect(readVerifiedBundleFile(dir, held, 'assets/app.js')).toEqual({ ok: false, reason: 'hash-mismatch' });
  });
});

describe('isSafeBundlePath', () => {
  it('accepts the paths a renderer build has', () => {
    for (const ok of ['index.html', 'assets/index-CBp6UIhS.js', 'a/b/c.d.e', '.well-known/x']) expect(isSafeBundlePath(ok), ok).toBe(true);
  });
});
