/*
 * The committed xlsx preview fixtures are exactly what make-fixtures.mjs
 * writes, so the script beside them stays the record of how they were made,
 * and fixtures.yaml lists each of them once. The hostile fixture aims one link
 * at the harness origin, which must stay the one the browser spec serves.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';

import type { PreviewFixture } from '../../../../../../e2e/document-preview/harness';
import { HARNESS_ORIGIN, xlsxFixtureFiles } from '../../../../../../e2e/document-preview/fixtures/xlsx/make-fixtures.mjs';
import documentPreviewConfig from '../../../../../../playwright.document-preview.config';

/* The Playwright config is loaded for its values only, so Playwright itself
   stays out: loading it under happy-dom ends in a refused connection to
   localhost:3000 after the tests pass. */
vi.mock('@playwright/test', () => ({ defineConfig: <T>(config: T): T => config, devices: {} }));

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

  it('aim at the origin the web project serves the harness page from', () => {
    const web = documentPreviewConfig.projects?.find(({ name }) => name === 'web');
    expect(new URL(String(web?.use?.baseURL)).origin, 'set HARNESS_ORIGIN in make-fixtures.mjs to the new origin and rerun the script').toBe(HARNESS_ORIGIN);
  });
});
