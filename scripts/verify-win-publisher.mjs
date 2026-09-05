#!/usr/bin/env node
// Fail the build unless the signed installer matches electron-updater's publisherName pin.
// Missing pins skip verification; changed certificates can break deployed updaters.
// Use the updater's exact parseDn matching against the signing report.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseDn } = require('builder-util-runtime');

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('usage: verify-win-publisher.mjs <signing-report.json>');
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const { resolveWindowsPublisherNames } = await import(
  new URL('../dist/main/shared/shell-update-feed.js', import.meta.url).href
);
const publisherNames = resolveWindowsPublisherNames(process.env.COWORK_WIN_PUBLISHER_CN);

if (report.status !== 'Valid') {
  console.error(`::error::signing report status is "${report.status}" (expected "Valid"): ${report.statusMessage || ''}`);
  process.exit(1);
}

// Match electron-updater's windowsExecutableCodeSignatureVerifier.
const subject = parseDn(report.signerSubject || '');
const matched = publisherNames.some(name => {
  const dn = parseDn(name);
  if (dn.size) return Array.from(dn.keys()).every(key => dn.get(key) === subject.get(key));
  return name === subject.get('CN');
});

if (!matched) {
  console.error('::error::Signed installer publisher does not match the pinned publisherName — auto-update would reject it.');
  console.error(`  pinned publisherNames: ${JSON.stringify(publisherNames)}`);
  console.error(`  signer subject: ${report.signerSubject}`);
  console.error('  If the signing certificate legitimately changed, update WINDOWS_PUBLISHER_CN in src/shared/shell-update-feed.ts (or set COWORK_WIN_PUBLISHER_CN).');
  process.exit(1);
}

console.log(`Publisher pin OK: signer subject matches ${JSON.stringify(publisherNames)}`);
