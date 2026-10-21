/*
 * The committed pptx preview fixtures are exactly what make-fixtures.mjs
 * writes from decks.yaml, so the script beside them stays the record of how
 * they were made.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FIXTURE_DIR, fixtureFiles } from '../../../../../../e2e/document-preview/fixtures/pptx/deck';

describe('pptx preview fixtures', () => {
  it('match what make-fixtures.mjs writes, byte for byte', async () => {
    const files = await fixtureFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const { file, bytes } of files) {
      const committed = readFileSync(join(FIXTURE_DIR, file));
      expect(Buffer.from(bytes).equals(committed), `${file} differs; rerun make-fixtures.mjs`).toBe(true);
    }
  });
});
