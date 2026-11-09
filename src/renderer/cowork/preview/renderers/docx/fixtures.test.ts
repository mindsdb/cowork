/*
 * The committed Word preview fixtures are exactly what make-fixtures.mjs
 * writes, but for python-docx-report.docx, which make-python-docx-fixture.py
 * writes. So the scripts beside them stay the record of how they were made,
 * and fixtures.yaml lists each .docx in the folder once.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import type { PreviewFixture } from '../../../../../../e2e/document-preview/harness';
import { docxFixtureFiles } from '../../../../../../e2e/document-preview/fixtures/docx/make-fixtures.mjs';

const FIXTURES = join(__dirname, '../../../../../../e2e/document-preview/fixtures/docx');
/* The fixture make-python-docx-fixture.py writes with python-docx.
   make-fixtures.mjs doesn't write it, so the byte check leaves it out, and
   rerunning that Python script with the python-docx version it names is how
   it is made again. */
const PYTHON_FIXTURES: readonly string[] = ['python-docx-report.docx'];

describe('docx preview fixtures', () => {
  it('match what make-fixtures.mjs writes, byte for byte', async () => {
    for (const { file, bytes } of await docxFixtureFiles()) {
      expect(Buffer.from(bytes).equals(readFileSync(join(FIXTURES, file))), `${file} differs; rerun make-fixtures.mjs`).toBe(true);
    }
  });

  it('are each listed once in fixtures.yaml, with every .docx in the folder', async () => {
    const listed = (load(readFileSync(join(FIXTURES, 'fixtures.yaml'), 'utf8')) as PreviewFixture[]).map(({ file }) => file);
    const written = (await docxFixtureFiles()).map(({ file }) => file);

    expect(listed.filter((file) => !PYTHON_FIXTURES.includes(file))).toEqual(written);
    expect(listed.filter((file) => PYTHON_FIXTURES.includes(file))).toEqual(PYTHON_FIXTURES);
    expect(readdirSync(FIXTURES).filter((name) => name.endsWith('.docx')).sort()).toEqual([...listed].sort());
  });
});
