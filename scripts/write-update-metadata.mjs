#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
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
  const require = createRequire(import.meta.url);
  const { appBuilderPath } = require('app-builder-bin');
  const result = spawnSync(
    appBuilderPath,
    ['blockmap', '--input', artifact, '--output', blockmapOutput],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`app-builder blockmap failed with exit code ${result.status}`);
  }
}

const bytes = readFileSync(artifact);
const sha512 = createHash('sha512').update(bytes).digest('base64');
const name = basename(artifact);
// JSON-quoted strings are valid YAML scalars and prevent filenames from
// changing the metadata structure.
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
