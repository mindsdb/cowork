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

// The product's name lives in src/shared/product-name.ts, so a web build with
// a deployment brand can show the brand's name in its place. A name typed
// straight into renderer or shared code would show "MindsHub Cowork" to that
// deployment's users. Only the files below may carry it. The two pages hold
// their stock tab title, which the brand replaces at load, and the fixture is
// sample document content. Main is left out: the renderer imports nothing from
// it, and desktop never loads a brand.
const NAME = ['MindsHub', 'Cowork'].join(' ');
const NAME_ALLOWED: Record<string, number> = {
  'shared/product-name.ts': 1,
  'renderer/index.html': 1,
  'renderer/index-web.html': 1,
  'renderer/visual-fixtures/artifact-review.tsx': 1,
};

describe('branding', () => {
  it(`no source file names the app "${OLD_NAME}"`, () => {
    const srcRoot = path.resolve(__dirname, '..');
    const offenders = walk(srcRoot).filter(
      (file) => !file.endsWith('branding.test.ts') && fs.readFileSync(file, 'utf8').includes(OLD_NAME),
    );
    expect(offenders).toEqual([]);
  });

  it(`renderer and shared code take "${NAME}" from product-name.ts`, () => {
    const srcRoot = path.resolve(__dirname, '..');
    const found: Record<string, number> = {};
    for (const dir of ['renderer', 'shared']) {
      for (const file of walk(path.join(srcRoot, dir))) {
        if (/\.test\./.test(file)) continue;
        // Collapse whitespace so a name broken across JSX lines still counts.
        const text = fs.readFileSync(file, 'utf8').replace(/\s+/g, ' ');
        const count = text.split(NAME).length - 1;
        if (count) found[path.relative(srcRoot, file).split(path.sep).join('/')] = count;
      }
    }
    expect(found).toEqual(NAME_ALLOWED);
  });
});
