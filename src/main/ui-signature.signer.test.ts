/* The release signer (scripts/sign-ui-bundle.mjs) and the desktop verifier (ui-signature.ts)
   implement one format from two sides. This test signs a folder with the real signer, unpacks
   the tarball it wrote the way the updater does, and checks the result with the real verifier,
   so a change on either side that the other doesn't follow fails here. */
import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SIGNATURE_JSON_NAME, TARBALL_NAME, signUiBundle } from '../../scripts/sign-ui-bundle.mjs';
import { parseUiPublicKey, verifyBundleFolder, verifyLatestSignature } from './ui-signature';

const workspaces: string[] = [];

afterEach(() => {
  for (const dir of workspaces.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-signer-cross-'));
  workspaces.push(dir);
  return dir;
}

function writeFile(root: string, relative: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), text);
}

function signedRelease(minServerVersion: string | null) {
  const root = workspace();
  const renderer = path.join(root, 'renderer');
  const out = path.join(root, 'out');
  const extracted = path.join(root, 'extracted');
  fs.mkdirSync(out);
  fs.mkdirSync(extracted);
  writeFile(renderer, 'index.html', '<!doctype html><script type="module" src="./assets/app.js"></script>');
  writeFile(renderer, 'assets/app.js', 'import "./chunk.js";');
  writeFile(renderer, 'assets/chunk.js', 'console.log(1);');
  writeFile(renderer, 'locales/en/common.json', '{"hello":"Hello"}');

  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKey = parseUiPublicKey(pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
  if (!publicKey) throw new Error('the generated key did not parse');
  const result = signUiBundle({
    dir: renderer,
    version: '2.26.11.24.1',
    minServerVersion,
    outDir: out,
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    expectedPublicKey: null,
  });
  execFileSync('tar', ['xzf', path.join(out, TARBALL_NAME), '-C', extracted]);
  const fields = JSON.parse(fs.readFileSync(path.join(out, SIGNATURE_JSON_NAME), 'utf8')) as { signed: string; signature: string };
  const tarballHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, TARBALL_NAME))).digest('hex');
  return { result, extracted, fields, tarballHash, keys: [publicKey] };
}

describe('signer and verifier agree on the format', () => {
  it.each([null, '0.26.11.20.1'])('verifies what the signer wrote, with server floor %s', (floor) => {
    const release = signedRelease(floor);

    const latest = verifyLatestSignature(release.fields, release.keys);
    expect(latest).toEqual({ ok: true, latest: { version: '2.26.11.24.1', sha256: release.tarballHash, minServerVersion: floor } });

    const folder = verifyBundleFolder(release.extracted, release.keys);
    if (!folder.ok) throw new Error(`folder check refused: ${folder.reason} ${folder.entry ?? ''}`);
    expect(folder.manifest.version).toBe('2.26.11.24.1');
    expect(folder.manifest.minServerVersion).toBe(floor);
    expect([...folder.manifest.files.keys()].sort()).toEqual(['assets/app.js', 'assets/chunk.js', 'index.html', 'locales/en/common.json']);
  });

  it('refuses the signed folder after one byte of one file changes', () => {
    const release = signedRelease(null);
    const file = path.join(release.extracted, 'assets', 'chunk.js');
    const bytes = fs.readFileSync(file);
    bytes[0] ^= 1;
    fs.writeFileSync(file, bytes);

    expect(verifyBundleFolder(release.extracted, release.keys)).toEqual({ ok: false, reason: 'hash-mismatch', entry: 'assets/chunk.js' });
  });

  it('refuses both documents under a key that did not sign them', () => {
    const release = signedRelease(null);
    const other = parseUiPublicKey(crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
    if (!other) throw new Error('the generated key did not parse');

    expect(verifyLatestSignature(release.fields, [other])).toEqual({ ok: false, reason: 'bad-signature' });
    expect(verifyBundleFolder(release.extracted, [other])).toEqual({ ok: false, reason: 'bad-signature' });
  });
});
