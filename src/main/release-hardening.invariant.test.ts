import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FuseV1Options } from '@electron/fuses';
import yaml from 'js-yaml';
import { describe, it, expect } from 'vitest';
import { RELEASE_FUSES } from '../../scripts/release-fuses.mjs';

/*
 * What a release build refuses: the Electron fuses electron-builder writes into
 * the packaged binary before signing, and the macOS entitlements the app and
 * its helpers are signed with. electron-builder.yml is parsed with js-yaml's
 * load, the function electron-builder's own config loader calls on this file,
 * so these are the values a build uses rather than what the text looks like.
 */
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG: unknown = yaml.load(readFileSync(path.join(REPO, 'electron-builder.yml'), 'utf8'));

/* The electronFuses block a release build needs: the fuses the setup smokes
   check on the installed app (scripts/release-fuses.mjs), under the names
   electron-builder gives them (FuseV1Options with a lowercase first letter). */
const EXPECTED_ELECTRON_FUSES: Record<string, boolean> = {
  ...Object.fromEntries(
    Object.entries(RELEASE_FUSES).map(([index, enabled]) => {
      const name = FuseV1Options[Number(index)];
      return [`${name[0].toLowerCase()}${name.slice(1)}`, enabled];
    }),
  ),
  /* Not a fuse: it re-signs the app ad hoc after the fuses are written, so an
     unsigned arm64 build still launches. */
  resetAdHocDarwinSignature: true,
};

/* Each lets code from outside the signed app load into it: one through DYLD_
   variables, one through libraries any team signed. */
const LIBRARY_INJECTION_ENTITLEMENTS = [
  'com.apple.security.cs.allow-dyld-environment-variables',
  'com.apple.security.cs.disable-library-validation',
];

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapping(value: unknown, name: string): Record<string, unknown> {
  if (!isMapping(value)) throw new Error(`electron-builder.yml: ${name} is not a mapping`);
  return value;
}

/* The keys of an entitlements plist. XML comments are removed first, so a key
   named only in a comment never counts; a key counts whatever its value. */
function entitlementKeys(file: string): string[] {
  const xml = readFileSync(path.join(REPO, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  return [...xml.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]);
}

const ROOT = mapping(CONFIG, 'the document');
const MAC = mapping(ROOT.mac, 'mac');

describe('release fuses', () => {
  it('sets every hardening fuse electron-builder writes before signing', () => {
    expect(mapping(ROOT.electronFuses, 'electronFuses')).toEqual(EXPECTED_ELECTRON_FUSES);
  });
});

describe('macOS entitlements', () => {
  it('signs under the hardened runtime, without which macOS checks neither', () => {
    expect(MAC.hardenedRuntime).toBe(true);
  });

  /* An unset key does not mean "no entitlements": app-builder-lib then signs
     with its own template, which grants disable-library-validation. */
  it.each(['entitlements', 'entitlementsInherit'])('names a file in mac.%s', (key) => {
    expect(typeof MAC[key], `mac.${key} must name this repo's entitlements file`).toBe('string');
  });

  it.each(['entitlements', 'entitlementsInherit'])(
    'mac.%s grants no way to load code from outside the signed app',
    (key) => {
      const file = MAC[key];
      if (typeof file !== 'string') throw new Error(`mac.${key} is not set`);
      const keys = entitlementKeys(file);
      /* V8 needs allow-jit under the hardened runtime, so a file without it
         was not read as the plist it should be. */
      expect(keys, `${file} has no allow-jit; was it parsed?`).toContain('com.apple.security.cs.allow-jit');
      for (const forbidden of LIBRARY_INJECTION_ENTITLEMENTS) {
        expect(keys, `${file} grants ${forbidden}`).not.toContain(forbidden);
      }
    },
  );
});
