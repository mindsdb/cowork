#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

function value(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument ${flag}`);
  }
  return process.argv[index + 1];
}

const platform = value('--platform');
const artifact = resolve(value('--artifact'));
const version = value('--version');
const output = resolve(value('--output'));
if (platform !== 'mac' && platform !== 'windows') {
  throw new Error(`Unsupported platform: ${platform}`);
}

const blockmapIndex = process.argv.indexOf('--blockmap-output');
if (blockmapIndex !== -1) {
  const blockmapOutput = resolve(value('--blockmap-output'));
  // Use electron-builder's own post-sign blockmap format. This deep import is coupled to the pinned
  // major version.
  const require = createRequire(import.meta.url);
  const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap.js');
  await buildBlockMap(artifact, 'gzip', blockmapOutput);
}

const bytes = readFileSync(artifact);
const sha512 = createHash('sha512').update(bytes).digest('base64');
const name = basename(artifact);
// JSON quoting produces valid YAML scalars without allowing filenames to alter its structure.
const yaml = [
  `version: ${JSON.stringify(version)}`,
  'files:',
  `  - url: ${JSON.stringify(name)}`,
  `    sha512: ${JSON.stringify(sha512)}`,
  `    size: ${statSync(artifact).size}`,
  `path: ${JSON.stringify(name)}`,
  `sha512: ${JSON.stringify(sha512)}`,
  `releaseDate: ${JSON.stringify(new Date().toISOString())}`,
  '',
].join('\n');

writeFileSync(output, yaml, 'utf8');
console.log(`[update-metadata] wrote ${output} for ${name} (${version})`);
