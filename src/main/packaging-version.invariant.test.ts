import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Regression guard: every Linux .deb shipped with internal version 2.0.7.
//
// electron-builder takes a package's version from `appInfo.version`, which is
// package.json's static `version` unless the build overrides it via
// `extraMetadata.version`. mac (run-electron-builder.mjs, CLI) and Windows
// (dist-win.mjs, programmatic API) both inject the resolved CalVer; `dist:linux`
// called electron-builder directly and injected nothing, so every deb's
// control-file `Version:` stayed 2.0.7 forever. CI renamed the FILE from
// app-version.gen.txt, which hid it — the documented `apt install ./….deb`
// upgrade path silently no-opped between releases ("already the newest
// version"), and `dpkg -l` could not tell two releases apart.
//
// The seam: a packaging entry point can look fine while bypassing the one
// wrapper that knows the real version. So this follows each CI entry point
// through the scripts it calls and asserts the injection is actually reachable.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS = path.join(REPO, '.github', 'workflows');
const SCRIPTS = path.join(REPO, 'scripts');

const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/**
 * `electron-builder` as its own command — `node scripts/run-electron-builder.mjs`
 * names it inside a longer filename and must not count.
 */
const BARE_ELECTRON_BUILDER = /(?<![-\w/])electron-builder(?![-\w.])/;

/** Both injection styles in use: `-c.extraMetadata.version=` and `extraMetadata: { version }`. */
const INJECTS_VERSION = /extraMetadata(?:\.version|\s*:\s*\{\s*version)/;

/** The npm scripts the three installer workflows run. */
const ciPackagingScripts = (): string[] => {
  const names = new Set<string>();
  for (const file of readdirSync(WORKFLOWS).filter((f) => /^build-(macos|windows|linux)/.test(f))) {
    const text = readFileSync(path.join(WORKFLOWS, file), 'utf8');
    for (const [, name] of text.matchAll(/run:\s*npm run ([\w:]+)/g)) names.add(name);
  }
  return [...names].sort();
};

/** A command plus every repo script it reaches, transitively. */
function reachableText(command: string, seen = new Set<string>()): string {
  let text = command;
  for (const [, file] of command.matchAll(/scripts\/([\w.-]+)/g)) {
    if (seen.has(file)) continue;
    seen.add(file);
    const full = path.join(SCRIPTS, file);
    if (!existsSync(full)) continue;
    text += `\n${reachableText(readFileSync(full, 'utf8'), seen)}`;
  }
  return text;
}

describe('installer builds inject the resolved app version', () => {
  // Anti-vacuous: silent empty detection would pass every assertion below.
  it('detects the three CI packaging entry points', () => {
    expect(ciPackagingScripts()).toEqual(['dist:linux', 'dist:win', 'release:mac:pkg:notarized']);
  });

  // THE regression: a bare invocation inherits package.json's static version.
  it('never invokes electron-builder directly from a packaging script', () => {
    const bare = ciPackagingScripts().filter((name) => BARE_ELECTRON_BUILDER.test(pkg.scripts[name] ?? ''));
    expect(bare).toEqual([]);
  });

  // Routing through a wrapper only helps if the injection is really reached.
  it('reaches an extraMetadata version injection from every entry point', () => {
    const missing = ciPackagingScripts().filter(
      (name) => !INJECTS_VERSION.test(reachableText(pkg.scripts[name] ?? '')),
    );
    expect(missing).toEqual([]);
  });

  // Self-checks: prove both matchers discriminate, independent of the real repo.
  it('distinguishes a bare invocation from the wrapper filename', () => {
    expect(BARE_ELECTRON_BUILDER.test('npm run build && electron-builder --linux')).toBe(true);
    expect(BARE_ELECTRON_BUILDER.test('node scripts/run-electron-builder.mjs --mac')).toBe(false);
  });

  it('recognises both injection styles and rejects a bare build', () => {
    expect(INJECTS_VERSION.test('-c.extraMetadata.version=1.2.3')).toBe(true);
    expect(INJECTS_VERSION.test('const config = { extraMetadata: { version: v } }')).toBe(true);
    expect(INJECTS_VERSION.test('electron-builder --linux --publish never')).toBe(false);
  });
});
