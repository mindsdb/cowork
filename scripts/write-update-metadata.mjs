#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { updateMetadataYaml } from './update-metadata.mjs';

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
  // electron-builder v26 dropped the app-builder Go binary (`app-builder-bin`);
  // blockmap generation now lives in pure JS inside app-builder-lib. Reuse its
  // own implementation so this post-sign blockmap is byte-format identical to
  // the one electron-builder emits pre-sign — gzip + separate output file
  // mirrors createBlockmap() in app-builder-lib's differentialUpdateInfoBuilder.
  // Deep-import path is coupled to the pinned electron-builder major version.
  const require = createRequire(import.meta.url);
  const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap.js');
  await buildBlockMap(artifact, 'gzip', blockmapOutput);
}

const bytes = readFileSync(artifact);
const sha512 = createHash('sha512').update(bytes).digest('base64');
const name = basename(artifact);
const yaml = updateMetadataYaml({
  platform,
  name,
  sha512,
  size: statSync(artifact).size,
  version,
  releaseDate: new Date().toISOString(),
});

writeFileSync(output, yaml, 'utf8');
console.log(`[update-metadata] wrote ${output} for ${name} (${version})`);
