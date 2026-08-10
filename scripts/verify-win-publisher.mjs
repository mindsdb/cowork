#!/usr/bin/env node
// Fail-closed gate for the Windows shell auto-updater's signature pin.
//
// electron-updater's NsisUpdater compares the installer's Authenticode subject
// against `publisherName` in app-update.yml and SKIPS verification entirely when
// that field is absent. We bake it (resolveWindowsPublisherNames), but a typo or
// a silently-renewed cert would either (a) brick auto-update in the field or
// (b) leave it unverified. This step proves, at build time, that the signed
// installer WOULD pass electron-updater's own check — by replicating its exact
// matching (builder-util-runtime's parseDn) against the signing report. On any
// mismatch it fails the build, so nothing insecure or self-bricking can ship.
//
//   node scripts/verify-win-publisher.mjs out/signing-report/installer-signature-report.json
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

// Same source of truth the build baked into app-update.yml.
const { resolveWindowsPublisherNames } = await import(
  new URL('../dist/main/shared/shell-update-feed.js', import.meta.url).href
);
const publisherNames = resolveWindowsPublisherNames(process.env.COWORK_WIN_PUBLISHER_CN);

if (report.status !== 'Valid') {
  console.error(`::error::signing report status is "${report.status}" (expected "Valid"): ${report.statusMessage || ''}`);
  process.exit(1);
}

// Verbatim from electron-updater's windowsExecutableCodeSignatureVerifier.
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
