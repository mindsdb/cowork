import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The app was renamed from "Anton Cowork" to "MindsHub Cowork"; Anton is the
// agent's name only. This scan keeps the old product name from creeping back
// into any source file. Built dynamically so this test doesn't flag itself.
const OLD_NAME = ['Anton', 'Cowork'].join(' ');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx|js|jsx|css|html|json)$/.test(entry.name) ? [full] : [];
  });
}

describe('branding', () => {
  it(`no source file names the app "${OLD_NAME}"`, () => {
    const srcRoot = path.resolve(__dirname, '..');
    const offenders = walk(srcRoot).filter(
      (file) => !file.endsWith('branding.test.ts') && fs.readFileSync(file, 'utf8').includes(OLD_NAME),
    );
    expect(offenders).toEqual([]);
  });
});
