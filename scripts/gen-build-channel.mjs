#!/usr/bin/env node
// Bakes COWORK_SERVER_REF / ANTON_REF into a generated TypeScript file that
// gets compiled into the Electron main bundle. Called as a `prebuild:main`
// npm hook so packaged apps carry the ref that was set at build time.
//
// Priority at runtime: process.env.COWORK_SERVER_REF > baked value > 'main'
// In dev mode (npm run dev:main, make app) the env var from the Makefile wins
// and this file is never needed — but it's safe to generate it anyway.

import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'src', 'main');
const outFile = join(outDir, 'build-channel.gen.ts');

const coworkRef = (process.env.COWORK_SERVER_REF || '').trim();
const antonRef = (process.env.ANTON_REF || '').trim();

mkdirSync(outDir, { recursive: true });
writeFileSync(
  outFile,
  [
    '// Auto-generated at build time by scripts/gen-build-channel.mjs — do not edit',
    `export const BUILD_COWORK_SERVER_REF = '${coworkRef}';`,
    `export const BUILD_ANTON_REF = '${antonRef}';`,
    '',
  ].join('\n'),
);

console.log(
  `[gen-build-channel] COWORK_SERVER_REF=${coworkRef || '(unset)'} ANTON_REF=${antonRef || '(unset)'}`,
);
