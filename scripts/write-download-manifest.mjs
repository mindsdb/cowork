#!/usr/bin/env node

/*
 * Writes the public download manifest that browser clients read to find the
 * current installer: which version is live, the immutable URL that serves it,
 * and the sha256 to check the finished file against.
 *
 * The release publishes this AFTER the installer object, and never names bytes
 * it has not already confirmed are in the bucket, so a client that reads the
 * manifest can always fetch what it points at.
 *
 * Everything here is derived from the installer file itself rather than passed
 * in alongside it. A version, a size and a hash that arrive as separate
 * arguments can disagree with the artifact; derived ones cannot.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const FILE_NAME_PATTERN = /^mindshub-cowork-(.+)\.(pkg|exe)$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PLATFORMS = ['mac', 'windows'];
const ALIAS_NAMES = ['latest', 'staging'];

/**
 * Pull the version out of a released installer's file name.
 *
 * Only the prod naming shape is accepted. Preview and stable builds carry a
 * channel and a commit sha in the same position (`...-2.0.1-stable-abc1234.pkg`),
 * and the mutable aliases sit at the same prefix under a fixed name. Publishing
 * either as the version the download page advertises would point every new user
 * at a snapshot build, or at a version literally called "latest".
 */
export function installerVersionFromFileName(fileName) {
  const match = FILE_NAME_PATTERN.exec(fileName);
  if (!match) {
    throw new Error(
      `Not a released installer file name: ${fileName} (expected mindshub-cowork-<version>.{pkg,exe})`,
    );
  }
  const version = match[1];
  const channel = /-(preview|stable)-/.exec(version)?.[1] ?? ALIAS_NAMES.find((a) => a === version);
  if (channel) {
    throw new Error(
      `Refusing to publish the ${channel} build as the released version: ${fileName}`,
    );
  }
  return version;
}

/** Build the manifest body. Pure: every field is an argument. */
export function downloadManifest({ fileName, platform, cdnBase, sizeBytes, sha256, publishedAt }) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported platform: ${platform} (expected ${PLATFORMS.join(' | ')})`);
  }
  if (!cdnBase || !cdnBase.startsWith('https://')) {
    throw new Error(`CDN base must be an https origin: ${cdnBase}`);
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`Size must be a positive integer byte count: ${sizeBytes}`);
  }
  if (!SHA256_PATTERN.test(sha256 ?? '')) {
    throw new Error(`Expected a lowercase hex sha256 digest: ${sha256}`);
  }
  if (Number.isNaN(Date.parse(publishedAt ?? ''))) {
    throw new Error(`Expected an ISO-8601 timestamp: ${publishedAt}`);
  }

  const version = installerVersionFromFileName(fileName);
  const key = `mindshub-cowork/${platform}/${fileName}`;
  return {
    version,
    key,
    url: `${cdnBase.replace(/\/+$/, '')}/${key}`,
    size_bytes: sizeBytes,
    sha256,
    published_at: publishedAt,
  };
}

function value(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument ${flag}`);
  }
  return process.argv[index + 1];
}

function main() {
  const artifact = resolve(value('--artifact'));
  const output = resolve(value('--output'));
  const manifest = downloadManifest({
    fileName: basename(artifact),
    platform: value('--platform'),
    cdnBase: value('--cdn-base'),
    sizeBytes: statSync(artifact).size,
    sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'),
    publishedAt: new Date().toISOString(),
  });
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(output, body);
  process.stdout.write(body);
}

if (process.argv[1] && process.argv[1].endsWith('write-download-manifest.mjs')) {
  main();
}
