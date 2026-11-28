#!/usr/bin/env node
/*
 * Signs a page update (the renderer build folder) at release.
 *
 *   UI_SIGNING_KEY="$(cat key.pem)" node scripts/sign-ui-bundle.mjs \
 *     --dir dist/renderer --version 1.26.11.24.1 [--min-server-version 0.26.11.20.1] \
 *     --out out/ [--check-public-key src/main/ui-release-public-key.ts]
 *
 * It writes ota-manifest.json (every file's SHA-256) and ota-manifest.sig (its
 * Ed25519 signature) into --dir, packs the folder into <out>/ui-bundle.tar.gz,
 * and writes <out>/ui-bundle.sha256 and <out>/ui-signature.json, which holds
 * the `signed` and `signature` fields that latest.json carries. The desktop
 * verifier in src/main checks both signatures against the release public key.
 *
 * The private key comes only from UI_SIGNING_KEY (a PKCS#8 PEM) and is never
 * printed. Every check runs before the first write. A manifest from an earlier
 * run in --dir is replaced, so signing the same folder twice is safe.
 */
import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

export const BUNDLE_KIND = 'cowork-ui-bundle';
export const LATEST_KIND = 'cowork-ui-latest';
export const SCHEMA = 1;

export const MANIFEST_NAME = 'ota-manifest.json';
export const MANIFEST_SIGNATURE_NAME = 'ota-manifest.sig';
export const TARBALL_NAME = 'ui-bundle.tar.gz';
export const TARBALL_HASH_NAME = 'ui-bundle.sha256';
export const SIGNATURE_JSON_NAME = 'ui-signature.json';

/* The one line of src/main/ui-release-public-key.ts that holds the release key. */
export const RELEASE_PUBLIC_KEY_LINE = /^export const RELEASE_UI_PUBLIC_KEY = '([A-Za-z0-9+/=]+)';$/m;

/**
 * The bundle manifest written to ota-manifest.json.
 * @typedef {object} BundleManifest
 * @property {typeof BUNDLE_KIND} kind
 * @property {typeof SCHEMA} schema
 * @property {string} version
 * @property {string | null} minServerVersion
 * @property {Record<string, string>} files  bundle-relative path (with `/`) to lowercase hex SHA-256
 */

/**
 * The payload whose bytes latest.json carries, base64-encoded, as `signed`.
 * @typedef {object} LatestPayload
 * @property {typeof LATEST_KIND} kind
 * @property {typeof SCHEMA} schema
 * @property {string} version
 * @property {string} sha256  lowercase hex SHA-256 of ui-bundle.tar.gz
 * @property {string | null} minServerVersion
 */

/**
 * The two fields latest.json gains, as written to ui-signature.json.
 * @typedef {object} SignedLatest
 * @property {string} signed  base64 of the LatestPayload's UTF-8 JSON bytes
 * @property {string} signature  base64 Ed25519 signature over those bytes
 */

/**
 * @typedef {object} SignOptions
 * @property {string} dir  renderer build folder; gains ota-manifest.json and ota-manifest.sig
 * @property {string} version
 * @property {string | null | undefined} minServerVersion  empty or absent means no server floor
 * @property {string} outDir  receives ui-bundle.tar.gz, ui-bundle.sha256 and ui-signature.json
 * @property {string} privateKeyPem  PKCS#8 PEM of the Ed25519 signing key
 * @property {string | null} expectedPublicKey  base64 SPKI DER the key must match, or null to skip the check
 */

/**
 * @typedef {object} SignResult
 * @property {BundleManifest} manifest
 * @property {LatestPayload} latest
 * @property {SignedLatest} signedLatest
 */

/** A refusal with a message fit for the one stderr line. */
export class SignError extends Error {}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {{ version: string, minServerVersion: string | null, files: Record<string, string> }} fields
 * @returns {BundleManifest}
 */
export function buildBundleManifest({ version, minServerVersion, files }) {
  return { kind: BUNDLE_KIND, schema: SCHEMA, version, minServerVersion, files };
}

/**
 * @param {{ version: string, sha256: string, minServerVersion: string | null }} fields
 * @returns {LatestPayload}
 */
export function buildLatestPayload({ version, sha256, minServerVersion }) {
  return { kind: LATEST_KIND, schema: SCHEMA, version, sha256, minServerVersion };
}

/**
 * Serializes a value to UTF-8 JSON and signs those exact bytes.
 * @param {unknown} value
 * @param {import('node:crypto').KeyObject} privateKey
 * @returns {{ bytes: Buffer, signature: string }}  the signed bytes and the base64 signature
 */
export function signJson(value, privateKey) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  return { bytes, signature: sign(null, bytes, privateKey).toString('base64') };
}

/**
 * Reads the release public key from the source text of src/main/ui-release-public-key.ts.
 * @param {string} source
 * @returns {string}  base64 SPKI DER
 */
export function readReleasePublicKey(source) {
  const match = RELEASE_PUBLIC_KEY_LINE.exec(source);
  if (!match) {
    throw new SignError("no line of the form \"export const RELEASE_UI_PUBLIC_KEY = '<base64>';\" in the public key file");
  }
  return match[1];
}

/**
 * Parses the signing key. The message on failure never quotes the key.
 * @param {string} pem
 * @returns {import('node:crypto').KeyObject}
 */
export function loadSigningKey(pem) {
  let key;
  try {
    key = createPrivateKey({ key: pem, format: 'pem' });
  } catch {
    throw new SignError('UI_SIGNING_KEY is not a readable PKCS#8 PEM private key');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new SignError(`UI_SIGNING_KEY is not an Ed25519 key (it is ${key.asymmetricKeyType})`);
  }
  return key;
}

/**
 * @param {import('node:crypto').KeyObject} privateKey
 * @returns {string}  base64 SPKI DER of the matching public key
 */
export function publicKeyBase64(privateKey) {
  return createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
}

/**
 * Hashes every regular file under dir, keyed by its bundle-relative path.
 * Refuses a symlink or any entry that is neither a regular file nor a
 * directory. Skips ota-manifest.json and ota-manifest.sig at the root, since
 * they are the output of an earlier run, and refuses those names anywhere
 * else, so no reading of "except the two manifest files" can disagree.
 * @param {string} dir
 * @returns {Record<string, string>}
 */
export function hashBundleFiles(dir) {
  /** @type {Record<string, string>} */
  const files = {};
  addFolder(dir, '', files);
  return files;
}

/**
 * @param {string} absoluteFolder
 * @param {string} bundleFolder  '' for the bundle root, else a path with `/`
 * @param {Record<string, string>} files
 */
function addFolder(absoluteFolder, bundleFolder, files) {
  for (const name of readdirSync(absoluteFolder).sort()) {
    const absolutePath = join(absoluteFolder, name);
    const bundlePath = bundleFolder === '' ? name : `${bundleFolder}/${name}`;
    /* The verifier refuses a manifest path holding a backslash, which Windows
       reads as a separator, so such a name never gets signed. */
    if (name.includes('\\')) {
      throw new SignError(`${bundlePath} has a backslash in its name; a page update path uses / only`);
    }
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new SignError(`${bundlePath} is a symlink; a page update holds only regular files and directories`);
    }
    if (name === MANIFEST_NAME || name === MANIFEST_SIGNATURE_NAME) {
      if (bundleFolder === '' && stat.isFile()) continue;
      throw new SignError(`${bundlePath}: ${name} is reserved for the signed manifest at the bundle root`);
    }
    if (stat.isDirectory()) {
      addFolder(absolutePath, bundlePath, files);
    } else if (stat.isFile()) {
      files[bundlePath] = sha256Hex(readFileSync(absolutePath));
    } else {
      throw new SignError(`${bundlePath} is not a regular file or directory`);
    }
  }
}

/**
 * Signs the folder and writes the bundle and its signature files.
 * @param {SignOptions} options
 * @returns {SignResult}
 */
export function signUiBundle(options) {
  const version = options.version.trim();
  if (version === '') throw new SignError('the version is empty');
  const minServerVersion = options.minServerVersion?.trim() || null;
  const dir = resolve(options.dir);
  const outDir = resolve(options.outDir);

  const privateKey = loadSigningKey(options.privateKeyPem);
  if (options.expectedPublicKey !== null) {
    const actual = publicKeyBase64(privateKey);
    if (actual !== options.expectedPublicKey) {
      throw new SignError(`the public key of UI_SIGNING_KEY (${actual}) differs from the release public key (${options.expectedPublicKey})`);
    }
  }

  requireBundleFolder(dir);
  requireOutFolder(outDir);
  if (isSameOrInside(dir, outDir)) throw new SignError(`--out ${options.outDir} is inside --dir ${options.dir}`);
  const files = hashBundleFiles(dir);
  if (!('index.html' in files)) throw new SignError(`--dir ${options.dir} has no index.html at its root`);

  const manifest = buildBundleManifest({ version, minServerVersion, files });
  const signedManifest = signJson(manifest, privateKey);
  writeFileSync(join(dir, MANIFEST_NAME), signedManifest.bytes);
  writeFileSync(join(dir, MANIFEST_SIGNATURE_NAME), signedManifest.signature);

  /* Build the outputs in a private folder and copy them into --out only once
     everything is signed, so a failure leaves --out untouched. */
  const staging = mkdtempSync(join(tmpdir(), 'sign-ui-bundle-'));
  try {
    const tarballPath = join(staging, TARBALL_NAME);
    writeTarball(dir, tarballPath);
    const sha256 = sha256Hex(readFileSync(tarballPath));
    const latest = buildLatestPayload({ version, sha256, minServerVersion });
    const signedPayload = signJson(latest, privateKey);
    /** @type {SignedLatest} */
    const signedLatest = { signed: signedPayload.bytes.toString('base64'), signature: signedPayload.signature };
    writeFileSync(join(staging, TARBALL_HASH_NAME), `${sha256}\n`);
    writeFileSync(join(staging, SIGNATURE_JSON_NAME), `${JSON.stringify(signedLatest, null, 2)}\n`);

    mkdirSync(outDir, { recursive: true });
    for (const name of [TARBALL_NAME, TARBALL_HASH_NAME, SIGNATURE_JSON_NAME]) {
      copyFileSync(join(staging, name), join(outDir, name));
    }
    return { manifest, latest, signedLatest };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Runs `tar czf <tarball> -C <dir> .`, the same command the release used before signing.
 * @param {string} dir
 * @param {string} tarballPath
 */
function writeTarball(dir, tarballPath) {
  /* tar gets no copy of the signing key. COPYFILE_DISABLE stops macOS tar
     from adding ._ metadata entries; GNU tar ignores it. */
  const env = { ...process.env, COPYFILE_DISABLE: '1' };
  delete env.UI_SIGNING_KEY;
  const result = spawnSync('tar', ['czf', tarballPath, '-C', dir, '.'], { encoding: 'utf8', env });
  if (result.error) throw new SignError(`tar could not start: ${result.error.message}`);
  if (result.status !== 0) throw new SignError(`tar exited with ${result.status}: ${result.stderr.trim()}`);
}

/**
 * --dir must be a real directory, not a symlink to one.
 * @param {string} dir
 */
function requireBundleFolder(dir) {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch (err) {
    throw new SignError(`--dir ${dir} cannot be read (${err.code})`);
  }
  if (stat.isSymbolicLink()) throw new SignError(`--dir ${dir} is a symlink`);
  if (!stat.isDirectory()) throw new SignError(`--dir ${dir} is not a directory`);
}

/**
 * --out may be missing (it is created after signing) or a directory.
 * @param {string} outDir
 */
function requireOutFolder(outDir) {
  let stat;
  try {
    stat = statSync(outDir);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw new SignError(`--out ${outDir} cannot be read (${err.code})`);
  }
  if (!stat.isDirectory()) throw new SignError(`--out ${outDir} is not a directory`);
}

/**
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
function isSameOrInside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/**
 * @typedef {object} CommandLine
 * @property {string} dir
 * @property {string} version
 * @property {string | undefined} minServerVersion
 * @property {string} out
 * @property {string | undefined} checkPublicKey
 */

/**
 * @param {string[]} argv
 * @returns {CommandLine}
 */
function parseCommandLine(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        dir: { type: 'string' },
        version: { type: 'string' },
        'min-server-version': { type: 'string' },
        out: { type: 'string' },
        'check-public-key': { type: 'string' },
      },
    }));
  } catch (err) {
    throw new SignError(err.message);
  }
  for (const flag of ['dir', 'version', 'out']) {
    if (!values[flag]) throw new SignError(`--${flag} is required`);
  }
  return {
    dir: values.dir,
    version: values.version,
    minServerVersion: values['min-server-version'],
    out: values.out,
    checkPublicKey: values['check-public-key'],
  };
}

/**
 * The command line entry point. Returns the exit code.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
export function main(argv, env) {
  try {
    const commandLine = parseCommandLine(argv);
    const privateKeyPem = env.UI_SIGNING_KEY;
    if (!privateKeyPem) throw new SignError('UI_SIGNING_KEY is not set; it must hold the PKCS#8 PEM of the Ed25519 signing key');

    let expectedPublicKey = null;
    if (commandLine.checkPublicKey !== undefined) {
      let source;
      try {
        source = readFileSync(commandLine.checkPublicKey, 'utf8');
      } catch (err) {
        throw new SignError(`--check-public-key ${commandLine.checkPublicKey} cannot be read (${err.code})`);
      }
      expectedPublicKey = readReleasePublicKey(source);
    }

    const result = signUiBundle({
      dir: commandLine.dir,
      version: commandLine.version,
      minServerVersion: commandLine.minServerVersion,
      outDir: commandLine.out,
      privateKeyPem,
      expectedPublicKey,
    });
    const fileCount = Object.keys(result.manifest.files).length;
    process.stdout.write(`signed page update ${result.latest.version}: ${fileCount} files, ${TARBALL_NAME} sha256 ${result.latest.sha256}\n`);
    return 0;
  } catch (err) {
    const message = err instanceof SignError ? err.message : `unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    process.stderr.write(`sign-ui-bundle: ${message.split('\n')[0]}\n`);
    return 1;
  }
}

if (process.argv[1]?.endsWith('sign-ui-bundle.mjs')) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
