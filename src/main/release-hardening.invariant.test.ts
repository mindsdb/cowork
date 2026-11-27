import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FuseV1Options } from '@electron/fuses';
import yaml from 'js-yaml';
import { Minimatch } from 'minimatch';
import { describe, it, expect } from 'vitest';
import { FORBIDDEN_ENTITLEMENTS } from '../../scripts/release-app-check.mjs';
import { RELEASE_FUSES } from '../../scripts/release-fuses.mjs';

/*
 * What a release build refuses: the Electron fuses electron-builder writes into
 * the packaged binary before signing, the macOS entitlements the app and its
 * helpers are signed with, and the files left outside app.asar, where asar
 * integrity does not reach. Also the repository access the page-update
 * publish gets. electron-builder.yml and the workflows are parsed with
 * js-yaml's load, the function electron-builder's own config loader calls on
 * its file, so these are the values a build uses rather than what the text
 * looks like.
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
      /* The keys the release check refuses on the built and the installed app
         (scripts/release-app-check.mjs). */
      expect(FORBIDDEN_ENTITLEMENTS.length).toBeGreaterThan(0);
      for (const forbidden of FORBIDDEN_ENTITLEMENTS) {
        expect(keys, `${file} grants ${forbidden}`).not.toContain(forbidden);
      }
    },
  );
});

/* A workflow's jobs, keyed by id. */
function workflowJobs(file: string): Record<string, Record<string, unknown>> {
  const parsed: unknown = yaml.load(readFileSync(path.join(REPO, '.github/workflows', file), 'utf8'));
  const jobs = isMapping(parsed) ? parsed.jobs : undefined;
  if (!isMapping(jobs)) throw new Error(`${file} has no jobs`);
  return Object.fromEntries(
    Object.entries(jobs).map(([id, job]) => {
      if (!isMapping(job)) throw new Error(`${file}: job ${id} is not a mapping`);
      return [id, job];
    }),
  );
}

describe('page update publishing', () => {
  /* publish-ui.yml writes with RELEASES_TOKEN alone, so the repository token
     its caller grants needs no more than the read access its jobs ask for. */
  it('grants publish-ui read access to this repository and nothing more', () => {
    expect(workflowJobs('prod-build-deploy.yml')['publish-ui'].permissions).toEqual({ contents: 'read' });
    for (const [id, job] of Object.entries(workflowJobs('publish-ui.yml'))) {
      expect(job.permissions, `publish-ui.yml job ${id}`).toEqual({ contents: 'read' });
    }
  });
});

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((entry): entry is string => typeof entry === 'string')) {
    throw new Error(`electron-builder.yml: ${name} is not a list of patterns`);
  }
  return value;
}

describe('asar unpacking', () => {
  /* app-builder-lib 26 matches each asarUnpack pattern with minimatch's `dot`
     option against a file's path inside the app folder, node_modules/...
     for a dependency (out/fileMatcher.js and out/util/filter.js). */
  const patterns = stringList(ROOT.asarUnpack, 'asarUnpack');
  const unpacks = (file: string) => patterns.some((pattern) => new Minimatch(pattern, { dot: true }).match(file));

  /* Smart unpack, on unless turned off, unpacks the whole folder of any module
     that holds a native file (out/asar/unpackDetector.js), keytar's and
     node-pty's JavaScript included. */
  it('turns smart unpack off', () => {
    expect(mapping(ROOT.asar, 'asar').smartUnpack).toBe(false);
  });

  it.each(['mac', 'win', 'linux'])('leaves asar and asarUnpack to the shared settings in %s', (platform) => {
    const block = mapping(ROOT[platform], platform);
    expect(block.asar).toBeUndefined();
    expect(block.asarUnpack).toBeUndefined();
  });

  it.each([
    'node_modules/keytar/build/Release/keytar.node',
    'node_modules/node-pty/build/Release/pty.node',
    'node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
    'node_modules/node-pty/prebuilds/win32-x64/conpty.node',
    'node_modules/node-pty/prebuilds/win32-x64/conpty_console_list.node',
    'node_modules/node-pty/prebuilds/win32-x64/conpty/conpty.dll',
    'node_modules/node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe',
    'node_modules/node-pty/build/Release/spawn-helper',
    'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper',
  ])('unpacks %s, which the app loads or runs by path', (file) => {
    expect(unpacks(file)).toBe(true);
  });

  it.each([
    'node_modules/keytar/lib/keytar.js',
    'node_modules/keytar/package.json',
    'node_modules/node-pty/lib/index.js',
    'node_modules/node-pty/lib/unixTerminal.js',
    'node_modules/node-pty/lib/windowsConoutConnection.js',
    'node_modules/node-pty/lib/worker/conoutSocketWorker.js',
    'node_modules/node-pty/package.json',
    'dist/main/main/index.js',
    'dist/main/main/coding-pty-host.js',
  ])('keeps %s inside app.asar', (file) => {
    expect(unpacks(file)).toBe(false);
  });
});
