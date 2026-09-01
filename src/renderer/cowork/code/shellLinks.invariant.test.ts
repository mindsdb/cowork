import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Grep-style guard, like scripts/check-cowork-purity.mjs: every OS-shell call
// under code/ goes through shellLinks.ts, where the URL and path rules live.
// A direct `host.openExternal(serverSuppliedUrl)` is how an unvalidated
// `javascript:`/`file:` link once reached the shell from TaskBar.

const CODE_DIR = path.dirname(fileURLToPath(import.meta.url));
const HELPER = 'shellLinks.ts';
const DIRECT_SHELL_CALL = /\bhost\.(openExternal|openPath|showItemInFolder)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.(tsx?|jsx?)$/.test(entry.name) || /\.test\.[jt]sx?$/.test(entry.name)) return [];
    return [full];
  });
}

describe('OS-shell access under code/', () => {
  it('is confined to the shellLinks helper', () => {
    const offenders = sourceFiles(CODE_DIR)
      .filter((file) => path.basename(file) !== HELPER)
      .flatMap((file) => readFileSync(file, 'utf8').split('\n').flatMap((line, index) => (
        DIRECT_SHELL_CALL.test(line) ? [`${path.relative(CODE_DIR, file)}:${index + 1}: ${line.trim()}`] : []
      )));
    expect(offenders).toEqual([]);
  });

  // Anti-vacuous: the pattern must still recognise the calls the helper makes.
  it('still sees the helper reaching the shell', () => {
    const helper = readFileSync(path.join(CODE_DIR, HELPER), 'utf8');
    expect(helper.split('\n').filter((line) => DIRECT_SHELL_CALL.test(line)).length).toBeGreaterThanOrEqual(3);
  });
});
