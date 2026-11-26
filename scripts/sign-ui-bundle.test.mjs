import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBundleManifest,
  buildLatestPayload,
  readReleasePublicKey,
  SignError,
} from './sign-ui-bundle.mjs';

const SCRIPT = fileURLToPath(new URL('./sign-ui-bundle.mjs', import.meta.url));
const CONTRACT_SAMPLE_KEY = 'MCowBQYDK2VwAyEAxSLdp5qsMA18HqM7McgDzufwQ04gSFNEI8K3VH8/dJQ=';

/** @typedef {{ pem: string, body: string, seedHex: string, seedBase64Url: string, publicKey: import('node:crypto').KeyObject, publicKeyBase64: string }} TestKey */

/** @returns {TestKey} */
function makeKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const seedBase64Url = privateKey.export({ format: 'jwk' }).d;
  return {
    pem,
    body: pem.split('\n').filter((line) => line && !line.startsWith('-----')).join(''),
    seedHex: Buffer.from(seedBase64Url, 'base64url').toString('hex'),
    seedBase64Url,
    publicKey,
    publicKeyBase64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

/* A renderer folder with a nested file, shared by most tests. */
function makeWorkspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'sign-ui-bundle-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'renderer');
  writeFile(dir, 'index.html', '<!doctype html><title>Cowork</title>');
  writeFile(dir, 'assets/app.js', 'console.log("page");\n');
  writeFile(dir, 'assets/fonts/inter.woff2', Buffer.from([0, 1, 2, 254, 255]));
  return { root, dir, out: join(root, 'out') };
}

function writeFile(dir, path, contents) {
  const target = join(dir, ...path.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function writeKeyFile(root, publicKeyBase64) {
  const path = join(root, 'ui-release-public-key.ts');
  writeFileSync(path, `/* Release public key. */\nexport const RELEASE_UI_PUBLIC_KEY = '${publicKeyBase64}';\n`);
  return path;
}

/* Every regular file under dir, keyed by `/` path, hashed independently of the signer. */
function listFiles(dir, prefix = '') {
  /** @type {Record<string, string>} */
  const files = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const key = prefix === '' ? name : `${prefix}/${name}`;
    if (lstatSync(path).isDirectory()) Object.assign(files, listFiles(path, key));
    else files[key] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return files;
}

/**
 * Runs the CLI with only PATH and the given variables, and checks that no
 * form of the private key reached stdout or stderr.
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @param {TestKey[]} keys  keys whose material must not appear
 */
function runSigner(args, env, keys) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });
  const printed = result.stdout + result.stderr;
  for (const key of keys) {
    for (const secret of [key.body, ...key.body.match(/.{1,16}/g), key.seedHex, key.seedBase64Url]) {
      assert.ok(!printed.includes(secret), 'the private key leaked into the output');
    }
  }
  return result;
}

function assertRefused(result, pattern) {
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^sign-ui-bundle: [^\n]+\n$/);
  assert.match(result.stderr, pattern);
}

function assertNothingWritten({ dir, out }) {
  assert.ok(!existsSync(out), '--out was created');
  assert.ok(!existsSync(join(dir, 'ota-manifest.json')), 'ota-manifest.json was written');
  assert.ok(!existsSync(join(dir, 'ota-manifest.sig')), 'ota-manifest.sig was written');
}

test('a signed bundle round-trips: manifest, signatures, hash and tarball all agree', (t) => {
  const key = makeKey();
  const workspace = makeWorkspace(t);
  const sourceFiles = listFiles(workspace.dir);
  const keyFile = writeKeyFile(workspace.root, key.publicKeyBase64);

  const result = runSigner(
    ['--dir', workspace.dir, '--version', '1.26.11.24.1', '--min-server-version', '0.26.11.20.1',
      '--out', workspace.out, '--check-public-key', keyFile],
    { UI_SIGNING_KEY: key.pem },
    [key],
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(readdirSync(workspace.out).sort(), ['ui-bundle.sha256', 'ui-bundle.tar.gz', 'ui-signature.json']);

  // The bundle manifest lists every file with its hash, uses `/`, and leaves out the manifest files.
  const manifestBytes = readFileSync(join(workspace.dir, 'ota-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.deepEqual(Object.keys(manifest), ['kind', 'schema', 'version', 'minServerVersion', 'files']);
  assert.equal(manifest.kind, 'cowork-ui-bundle');
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.version, '1.26.11.24.1');
  assert.equal(manifest.minServerVersion, '0.26.11.20.1');
  assert.deepEqual(manifest.files, sourceFiles);
  assert.ok('assets/fonts/inter.woff2' in manifest.files);

  // ota-manifest.sig verifies over the exact bytes of ota-manifest.json.
  const manifestSignature = Buffer.from(readFileSync(join(workspace.dir, 'ota-manifest.sig'), 'utf8').trim(), 'base64');
  assert.equal(manifestSignature.length, 64);
  assert.ok(verify(null, manifestBytes, key.publicKey, manifestSignature));

  // `signed` decodes to the contract's payload and `signature` verifies over those bytes.
  const tarball = readFileSync(join(workspace.out, 'ui-bundle.tar.gz'));
  const tarballHash = createHash('sha256').update(tarball).digest('hex');
  const signatureJson = JSON.parse(readFileSync(join(workspace.out, 'ui-signature.json'), 'utf8'));
  assert.deepEqual(Object.keys(signatureJson), ['signed', 'signature']);
  const signedBytes = Buffer.from(signatureJson.signed, 'base64');
  const payload = JSON.parse(signedBytes.toString('utf8'));
  assert.deepEqual(Object.keys(payload), ['kind', 'schema', 'version', 'sha256', 'minServerVersion']);
  assert.deepEqual(payload, {
    kind: 'cowork-ui-latest',
    schema: 1,
    version: '1.26.11.24.1',
    sha256: tarballHash,
    minServerVersion: '0.26.11.20.1',
  });
  assert.ok(verify(null, signedBytes, key.publicKey, Buffer.from(signatureJson.signature, 'base64')));

  // The tarball's hash is the one in ui-bundle.sha256 and in the signed payload.
  assert.equal(readFileSync(join(workspace.out, 'ui-bundle.sha256'), 'utf8'), `${tarballHash}\n`);

  // The tarball extracts to the folder's files plus the two manifest files.
  const extracted = join(workspace.root, 'extracted');
  mkdirSync(extracted);
  const tar = spawnSync('tar', ['xzf', join(workspace.out, 'ui-bundle.tar.gz'), '-C', extracted], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  const extractedFiles = listFiles(extracted);
  assert.deepEqual(Object.keys(extractedFiles).sort(), [...Object.keys(sourceFiles), 'ota-manifest.json', 'ota-manifest.sig'].sort());
  assert.deepEqual(extractedFiles, listFiles(workspace.dir));
});

test('signing the same folder again replaces the manifest and never lists it', (t) => {
  const key = makeKey();
  const workspace = makeWorkspace(t);
  const sourceFiles = listFiles(workspace.dir);
  const env = { UI_SIGNING_KEY: key.pem };

  assert.equal(runSigner(['--dir', workspace.dir, '--version', '1.0.0', '--out', workspace.out], env, [key]).status, 0);
  const second = runSigner(['--dir', workspace.dir, '--version', '1.0.1', '--out', workspace.out], env, [key]);
  assert.equal(second.status, 0, second.stderr);

  const manifestBytes = readFileSync(join(workspace.dir, 'ota-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.version, '1.0.1');
  assert.deepEqual(manifest.files, sourceFiles);
  const signature = Buffer.from(readFileSync(join(workspace.dir, 'ota-manifest.sig'), 'utf8'), 'base64');
  assert.ok(verify(null, manifestBytes, key.publicKey, signature));
});

for (const [label, flags] of [
  ['absent', []],
  ['empty', ['--min-server-version', '']],
]) {
  test(`minServerVersion is null in both payloads when --min-server-version is ${label}`, (t) => {
    const key = makeKey();
    const workspace = makeWorkspace(t);
    const result = runSigner(
      ['--dir', workspace.dir, '--version', '1.0.0', ...flags, '--out', workspace.out],
      { UI_SIGNING_KEY: key.pem },
      [key],
    );
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(join(workspace.dir, 'ota-manifest.json'), 'utf8'));
    const { signed } = JSON.parse(readFileSync(join(workspace.out, 'ui-signature.json'), 'utf8'));
    const payload = JSON.parse(Buffer.from(signed, 'base64').toString('utf8'));
    assert.equal(manifest.minServerVersion, null);
    assert.equal(payload.minServerVersion, null);
  });
}

test('a symlink in the folder is refused before anything is written', (t) => {
  const key = makeKey();
  const workspace = makeWorkspace(t);
  symlinkSync('../index.html', join(workspace.dir, 'assets', 'linked.html'));
  const result = runSigner(['--dir', workspace.dir, '--version', '1.0.0', '--out', workspace.out], { UI_SIGNING_KEY: key.pem }, [key]);
  assertRefused(result, /assets\/linked\.html is a symlink/);
  assertNothingWritten(workspace);
});

test('a FIFO in the folder is refused before anything is written', (t) => {
  const key = makeKey();
  const workspace = makeWorkspace(t);
  const mkfifo = spawnSync('mkfifo', [join(workspace.dir, 'pipe')]);
  if (mkfifo.status !== 0) return t.skip('mkfifo is not available');
  const result = runSigner(['--dir', workspace.dir, '--version', '1.0.0', '--out', workspace.out], { UI_SIGNING_KEY: key.pem }, [key]);
  assertRefused(result, /pipe is not a regular file or directory/);
  assertNothingWritten(workspace);
});

test('a file name with a backslash is refused before anything is written', (t) => {
  if (process.platform === 'win32') return t.skip('Windows cannot create such a name');
  const key = makeKey();
  const workspace = makeWorkspace(t);
  writeFileSync(join(workspace.dir, 'assets', 'a\\b.js'), 'x');
  const result = runSigner(['--dir', workspace.dir, '--version', '1.0.0', '--out', workspace.out], { UI_SIGNING_KEY: key.pem }, [key]);
  assertRefused(result, /assets\/a\\b\.js has a backslash in its name/);
  assertNothingWritten(workspace);
});

test('a manifest file name below the bundle root is refused', (t) => {
  const key = makeKey();
  const workspace = makeWorkspace(t);
  writeFile(workspace.dir, 'assets/ota-manifest.json', '{}');
  const result = runSigner(['--dir', workspace.dir, '--version', '1.0.0', '--out', workspace.out], { UI_SIGNING_KEY: key.pem }, [key]);
  assertRefused(result, /assets\/ota-manifest\.json: ota-manifest\.json is reserved/);
  assertNothingWritten(workspace);
});

test('a folder without index.html at its root is refused', (t) => {
  const key = makeKey();
  const workspace = makeWorkspace(t);
  rmSync(join(workspace.dir, 'index.html'));
  const result = runSigner(['--dir', workspace.dir, '--version', '1.0.0', '--out', workspace.out], { UI_SIGNING_KEY: key.pem }, [key]);
  assertRefused(result, /has no index\.html at its root/);
  assertNothingWritten(workspace);
});

test('--out inside --dir is refused', (t) => {
  const key = makeKey();
  const workspace = makeWorkspace(t);
  const out = join(workspace.dir, 'out');
  const result = runSigner(['--dir', workspace.dir, '--version', '1.0.0', '--out', out], { UI_SIGNING_KEY: key.pem }, [key]);
  assertRefused(result, /is inside --dir/);
  assertNothingWritten({ dir: workspace.dir, out });
});

test('--check-public-key with the signing key\'s own public key signs', (t) => {
  const key = makeKey();
  const workspace = makeWorkspace(t);
  const keyFile = writeKeyFile(workspace.root, key.publicKeyBase64);
  const result = runSigner(
    ['--dir', workspace.dir, '--version', '1.0.0', '--out', workspace.out, '--check-public-key', keyFile],
    { UI_SIGNING_KEY: key.pem },
    [key],
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^signed page update 1\.0\.0: 3 files, ui-bundle\.tar\.gz sha256 [0-9a-f]{64}\n$/);
});

test('--check-public-key with a different key exits non-zero and writes nothing', (t) => {
  const key = makeKey();
  const otherKey = makeKey();
  const workspace = makeWorkspace(t);
  const keyFile = writeKeyFile(workspace.root, otherKey.publicKeyBase64);
  const result = runSigner(
    ['--dir', workspace.dir, '--version', '1.0.0', '--out', workspace.out, '--check-public-key', keyFile],
    { UI_SIGNING_KEY: key.pem },
    [key, otherKey],
  );
  assertRefused(result, /differs from the release public key/);
  assertNothingWritten(workspace);
});

test('--check-public-key on a file without the one-line shape is refused', (t) => {
  const key = makeKey();
  const workspace = makeWorkspace(t);
  const keyFile = join(workspace.root, 'ui-release-public-key.ts');
  writeFileSync(keyFile, `export const RELEASE_UI_PUBLIC_KEY = "${key.publicKeyBase64}";\n`);
  const result = runSigner(
    ['--dir', workspace.dir, '--version', '1.0.0', '--out', workspace.out, '--check-public-key', keyFile],
    { UI_SIGNING_KEY: key.pem },
    [key],
  );
  assertRefused(result, /no line of the form/);
  assertNothingWritten(workspace);
});

test('a missing UI_SIGNING_KEY exits non-zero and writes nothing', (t) => {
  const workspace = makeWorkspace(t);
  const result = runSigner(['--dir', workspace.dir, '--version', '1.0.0', '--out', workspace.out], {}, []);
  assertRefused(result, /UI_SIGNING_KEY is not set/);
  assertNothingWritten(workspace);
});

test('an unreadable or non-Ed25519 UI_SIGNING_KEY is refused without echoing it', (t) => {
  const key = makeKey();
  const workspace = makeWorkspace(t);
  const truncated = key.pem.replace(key.body, key.body.slice(0, 40));
  const rsaPem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' });
  const rsaBody = rsaPem.split('\n').filter((line) => line && !line.startsWith('-----'));

  for (const [pem, pattern] of [
    [truncated, /not a readable PKCS#8 PEM private key/],
    [key.body, /not a readable PKCS#8 PEM private key/],
    [rsaPem, /UI_SIGNING_KEY is not an Ed25519 key \(it is rsa\)/],
  ]) {
    const result = runSigner(['--dir', workspace.dir, '--version', '1.0.0', '--out', workspace.out], { UI_SIGNING_KEY: pem }, [key]);
    assertRefused(result, pattern);
    for (const line of rsaBody) assert.ok(!result.stderr.includes(line), 'the RSA key leaked into the output');
    assertNothingWritten(workspace);
  }
});

test('the private key is never printed, on success or on failure', (t) => {
  /* runSigner asserts this for every run above; this test names the
     guarantee and covers a success and a refusal back to back. */
  const key = makeKey();
  const workspace = makeWorkspace(t);
  const ok = runSigner(['--dir', workspace.dir, '--version', '1.0.0', '--out', workspace.out], { UI_SIGNING_KEY: key.pem }, [key]);
  assert.equal(ok.status, 0, ok.stderr);
  const refused = runSigner(['--dir', join(workspace.root, 'missing'), '--version', '1.0.0', '--out', workspace.out], { UI_SIGNING_KEY: key.pem }, [key]);
  assertRefused(refused, /--dir .* cannot be read \(ENOENT\)/);
});

test('the key is taken only from the environment, never from a flag', (t) => {
  const key = makeKey();
  const workspace = makeWorkspace(t);
  const result = runSigner(['--dir', workspace.dir, '--version', '1.0.0', '--out', workspace.out, '--key', key.pem], {}, [key]);
  assertRefused(result, /Unknown option '--key'/);
  assertNothingWritten(workspace);
});

test('a missing required flag is refused', (t) => {
  const key = makeKey();
  const workspace = makeWorkspace(t);
  const result = runSigner(['--dir', workspace.dir, '--out', workspace.out], { UI_SIGNING_KEY: key.pem }, [key]);
  assertRefused(result, /--version is required/);
  assertNothingWritten(workspace);
});

test('the payload builders carry the contract\'s kind, schema and field order', () => {
  const manifest = buildBundleManifest({ version: '1.0.0', minServerVersion: null, files: { 'index.html': 'a'.repeat(64) } });
  assert.equal(
    JSON.stringify(manifest),
    `{"kind":"cowork-ui-bundle","schema":1,"version":"1.0.0","minServerVersion":null,"files":{"index.html":"${'a'.repeat(64)}"}}`,
  );
  const latest = buildLatestPayload({ version: '1.0.0', sha256: 'b'.repeat(64), minServerVersion: '0.1.0' });
  assert.equal(
    JSON.stringify(latest),
    `{"kind":"cowork-ui-latest","schema":1,"version":"1.0.0","sha256":"${'b'.repeat(64)}","minServerVersion":"0.1.0"}`,
  );
});

test('readReleasePublicKey reads the contract\'s one-line shape and nothing looser', () => {
  const line = `export const RELEASE_UI_PUBLIC_KEY = '${CONTRACT_SAMPLE_KEY}';`;
  assert.equal(readReleasePublicKey(`/* The release key. */\n${line}\n`), CONTRACT_SAMPLE_KEY);
  for (const source of [
    `export const RELEASE_UI_PUBLIC_KEY = "${CONTRACT_SAMPLE_KEY}";\n`,
    `  ${line}\n`,
    `export const RELEASE_UI_PUBLIC_KEY: string = '${CONTRACT_SAMPLE_KEY}';\n`,
    '',
  ]) {
    assert.throws(() => readReleasePublicKey(source), SignError);
  }
});

const RELEASE_KEY_FILE = resolve('src/main/ui-release-public-key.ts');
test('the release public key file holds one Ed25519 key in the shape the signer reads', { skip: !existsSync(RELEASE_KEY_FILE) && 'src/main/ui-release-public-key.ts does not exist yet' }, () => {
  const key = readReleasePublicKey(readFileSync(RELEASE_KEY_FILE, 'utf8'));
  assert.match(key, /^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/);
  assert.equal(Buffer.from(key, 'base64').length, 44);
});
