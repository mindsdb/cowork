/*
 * The committed PDF preview fixtures are exactly what make-fixtures.mjs
 * writes, so the script beside them stays the record of how they were made,
 * and fixtures.yaml lists each .pdf in the folder once.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import type { PreviewFixture } from '../../../../../../e2e/document-preview/harness';
import { pdfFixtureFiles } from '../../../../../../e2e/document-preview/fixtures/pdf/make-fixtures.mjs';

const FIXTURES = join(__dirname, '../../../../../../e2e/document-preview/fixtures/pdf');

describe('pdf preview fixtures', () => {
  it('match what make-fixtures.mjs writes, byte for byte', () => {
    for (const { file, bytes } of pdfFixtureFiles()) {
      expect(Buffer.from(bytes).equals(readFileSync(join(FIXTURES, file))), `${file} differs; rerun make-fixtures.mjs`).toBe(true);
    }
  });

  it('are each listed once in fixtures.yaml, with every .pdf in the folder', () => {
    const listed = (load(readFileSync(join(FIXTURES, 'fixtures.yaml'), 'utf8')) as PreviewFixture[]).map(({ file }) => file);

    expect(listed).toEqual(pdfFixtureFiles().map(({ file }) => file));
    expect(readdirSync(FIXTURES).filter((name) => name.endsWith('.pdf')).sort()).toEqual([...listed].sort());
  });
});
