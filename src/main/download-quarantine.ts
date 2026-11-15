/*
 * The mark macOS puts on a file that came from the web.
 *
 * Gatekeeper checks a file carrying com.apple.quarantine before it first
 * opens. Chromium writes that mark through a quarantine connection that
 * Electron's download delegate does not provide, so a file saved from the
 * in-app browser carries none unless main writes it. Windows writes its own
 * zone mark, and Linux has no equivalent, so this is macOS only.
 */

import { execFileSync } from 'child_process';

const XATTR = '/usr/bin/xattr';
const QUARANTINE_ATTRIBUTE = 'com.apple.quarantine';
const QUARANTINE_AGENT = 'MindsHub Cowork';
const XATTR_TIMEOUT_MS = 5_000;

/** The mark's value: the web-download flags, the time in hex seconds, and the agent. */
export function quarantineValue(now: Date): string {
  return `0081;${Math.floor(now.getTime() / 1000).toString(16)};${QUARANTINE_AGENT};`;
}

/**
 * Marks `file`, which the in-app browser saved, as downloaded from the web.
 * Does nothing outside macOS. Runs xattr directly, with no shell. Throws when
 * the mark could not be written, so the caller can withhold the file.
 */
export function markDownloaded(file: string): void {
  if (process.platform !== 'darwin') return;
  execFileSync(XATTR, ['-w', QUARANTINE_ATTRIBUTE, quarantineValue(new Date()), file], {
    stdio: 'ignore',
    timeout: XATTR_TIMEOUT_MS,
  });
}
