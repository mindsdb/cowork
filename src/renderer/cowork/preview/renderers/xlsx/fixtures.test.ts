/*
 * The committed xlsx preview fixtures are exactly what make-fixtures.mjs
 * writes, but for the four make-python-fixtures.py writes, so the scripts
 * beside them stay the record of how they were made, and fixtures.yaml lists
 * each of them once. The hostile fixture aims one link at the harness origin,
 * which must stay the one the browser spec serves.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PreviewFixture } from '../../../../../../e2e/document-preview/harness';
import { HARNESS_ORIGIN, xlsxFixtureFiles } from '../../../../../../e2e/document-preview/fixtures/xlsx/make-fixtures.mjs';
import documentPreviewConfig from '../../../../../../playwright.document-preview.config';

/* The Playwright config is loaded for its values only, so Playwright itself
   stays out: loading it under happy-dom ends in a refused connection to
   localhost:3000 after the tests pass. */
vi.mock('@playwright/test', () => ({ defineConfig: <T>(config: T): T => config, devices: {} }));

const FIXTURES = join(__dirname, '../../../../../../e2e/document-preview/fixtures/xlsx');
/* The fixtures make-python-fixtures.py writes with openpyxl and XlsxWriter.
   make-fixtures.mjs doesn't write them, so the byte check leaves them out, and
   rerunning that Python script with the library versions it names is how
   they are made again. */
const PYTHON_FIXTURES: readonly string[] = ['openpyxl-total.xlsx', 'xlsxwriter-total.xlsx', 'openpyxl-report.xlsx', 'xlsxwriter-report.xlsx'];
/* Writing every fixture builds three workbooks at the caps, which takes a few
   seconds alone and more on a loaded CI runner. So the files are written once
   for both checks, with a timeout of their own. */
const WRITE_TIMEOUT_MS = 60_000;

describe('xlsx preview fixtures', () => {
  let written: Awaited<ReturnType<typeof xlsxFixtureFiles>>;

  beforeAll(async () => {
    written = await xlsxFixtureFiles();
  }, WRITE_TIMEOUT_MS);

  it('match what make-fixtures.mjs writes, byte for byte', () => {
    for (const { file, bytes } of written) {
      expect(Buffer.from(bytes).equals(readFileSync(join(FIXTURES, file))), `${file} differs; rerun make-fixtures.mjs`).toBe(true);
    }
  });

  it('are each listed once in fixtures.yaml, as clean or hostile', () => {
    const listed = load(readFileSync(join(FIXTURES, 'fixtures.yaml'), 'utf8')) as PreviewFixture[];
    const files = written.map(({ file }) => file);

    expect(listed.map(({ file }) => file).filter((file) => !PYTHON_FIXTURES.includes(file))).toEqual(files);
    expect(listed.filter(({ file }) => PYTHON_FIXTURES.includes(file)).map(({ file }) => file)).toEqual(PYTHON_FIXTURES);
    expect(new Set(listed.map(({ name }) => name)).size).toBe(listed.length);
    expect(listed.filter(({ kind }) => kind !== 'clean' && kind !== 'hostile')).toEqual([]);
    expect(listed.map(({ kind }) => kind)).toContain('hostile');
  });

  it('aim at the origin the web project serves the harness page from', () => {
    const web = documentPreviewConfig.projects?.find(({ name }) => name === 'web');
    expect(new URL(String(web?.use?.baseURL)).origin, 'set HARNESS_ORIGIN in make-fixtures.mjs to the new origin and rerun the script').toBe(HARNESS_ORIGIN);
  });
});
