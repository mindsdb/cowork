/*
 * Writes the .pptx files that fixtures.yaml lists, each built from its deck in
 * decks.yaml by deck.ts. The renderer's fixtures test fails when a committed
 * file differs from what this writes. python-pptx.pptx is the one exception:
 * make-python-pptx.py writes it with python-pptx.
 *
 * Rewrite the committed files from the repository root with:
 *   node e2e/document-preview/fixtures/pptx/make-fixtures.mjs
 *
 * deck.ts is TypeScript, so this needs a Node that strips types on its own
 * (23.6 or later, or 22.18 or later); on an older Node 22, add
 * --experimental-strip-types.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FIXTURE_DIR, fixtureFiles } from './deck.ts';

for (const { file, bytes } of await fixtureFiles()) {
  writeFileSync(join(FIXTURE_DIR, file), bytes);
  console.log(`wrote ${file} (${bytes.length} bytes)`);
}
