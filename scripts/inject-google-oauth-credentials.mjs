#!/usr/bin/env node

// Bake Google OAuth credentials into the packaged Electron build.
//
// The Electron main process is compiled with tsc, so CI environment
// variables are not bundled by simply passing them to `npm run build`.
// This script patches the env passed to the cowork-server child process
// before the app is packaged.

import { readFileSync, writeFileSync } from 'node:fs';

const SERVER_PROCESS_PATH = 'src/main/server-process.ts';
const INJECTION_ANCHOR = '      COWORK_SERVER_HOST: SERVER_HOST,';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId) {
  throw new Error('GOOGLE_CLIENT_ID is required.');
}

if (!clientSecret) {
  throw new Error('GOOGLE_CLIENT_SECRET is required.');
}

const content = readFileSync(SERVER_PROCESS_PATH, 'utf8');
const anchorCount = content.split(INJECTION_ANCHOR).length - 1;

if (anchorCount !== 1) {
  throw new Error(
    `Expected exactly one OAuth credential injection anchor in ` +
      `${SERVER_PROCESS_PATH}, found ${anchorCount}.`,
  );
}

const injected = [
  INJECTION_ANCHOR,
  `      GOOGLE_CLIENT_ID: ${JSON.stringify(clientId)},`,
  `      GOOGLE_CLIENT_SECRET: ${JSON.stringify(clientSecret)},`,
].join('\n');

writeFileSync(
  SERVER_PROCESS_PATH,
  content.replace(INJECTION_ANCHOR, injected),
  'utf8',
);
