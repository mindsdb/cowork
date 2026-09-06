#!/usr/bin/env node

/*
 * Publish the per-platform/channel manifest only after uploading its installer.
 * Derive size/hash/version from the artifact and cross-check the destination key.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const KEY_PATTERN = /^mindshub-cowork\/(mac|windows|linux-amd64|linux-arm64)\/(?:snapshots\/)?([^/]+)$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ALIAS_NAMES = ['latest', 'staging'];

/*
 * Exclude preview/alias filenames. Strip Debian architecture suffixes so architectures share a
 * release version.
 */
const CHANNEL_FILE_NAMES = {
  prod: /^mindshub-cowork-((?!.*-(?:preview|stable)-).+?)(?:-(?:amd64|arm64))?\.(?:pkg|exe|deb)$/,
  stable: /^mindshub-cowork-(.+?-stable-[0-9a-f]+)(?:-(?:amd64|arm64))?\.(?:pkg|exe|deb)$/,
};

/**
 * Validate filename channel so a staging snapshot or latest alias cannot become the advertised
 * release version.
 */
export function installerVersionFromFileName(fileName, channel) {
  const pattern = CHANNEL_FILE_NAMES[channel];
  if (!pattern) {
    throw new Error(
      `No manifest is published for the ${channel} channel (expected ${Object.keys(CHANNEL_FILE_NAMES).join(' | ')})`,
    );
  }
  const version = pattern.exec(fileName)?.[1];
  if (!version) {
    throw new Error(`Not a ${channel} installer file name: ${fileName}`);
  }
  if (ALIAS_NAMES.includes(version)) {
    throw new Error(`Refusing to publish the ${version} alias as a version: ${fileName}`);
  }
  return version;
}

export function downloadManifest({ key, fileName, channel, cdnBase, sizeBytes, sha256, publishedAt }) {
  const keyed = KEY_PATTERN.exec(key);
  if (!keyed) {
    throw new Error(`Not an installer key: ${key}`);
  }
  if (keyed[2] !== fileName) {
    throw new Error(`Key names a different file than the artifact: ${key} vs ${fileName}`);
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

  return {
    version: installerVersionFromFileName(fileName, channel),
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
    key: value('--key'),
    fileName: basename(artifact),
    channel: value('--channel'),
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
