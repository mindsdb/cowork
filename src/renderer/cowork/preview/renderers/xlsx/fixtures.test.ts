/*
 * The committed xlsx preview fixtures are exactly what make-fixtures.mjs
 * writes, so the script beside them stays the record of how they were made,
 * and fixtures.yaml lists each of them once.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import type { PreviewFixture } from '../../../../../../e2e/document-preview/harness';
import { xlsxFixtureFiles } from '../../../../../../e2e/document-preview/fixtures/xlsx/make-fixtures.mjs';

const FIXTURES = join(__dirname, '../../../../../../e2e/document-preview/fixtures/xlsx');

describe('xlsx preview fixtures', () => {
  it('match what make-fixtures.mjs writes, byte for byte', async () => {
    for (const { file, bytes } of await xlsxFixtureFiles()) {
      expect(Buffer.from(bytes).equals(readFileSync(join(FIXTURES, file))), `${file} differs; rerun make-fixtures.mjs`).toBe(true);
    }
  });

  it('are each listed once in fixtures.yaml, as clean or hostile', async () => {
    const listed = load(readFileSync(join(FIXTURES, 'fixtures.yaml'), 'utf8')) as PreviewFixture[];
    const written = (await xlsxFixtureFiles()).map(({ file }) => file);

    expect(listed.map(({ file }) => file)).toEqual(written);
    expect(new Set(listed.map(({ name }) => name)).size).toBe(listed.length);
    expect(listed.filter(({ kind }) => kind !== 'clean' && kind !== 'hostile')).toEqual([]);
    expect(listed.map(({ kind }) => kind)).toContain('hostile');
  });
});
