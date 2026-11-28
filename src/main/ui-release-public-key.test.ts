/* The app imports RELEASE_UI_PUBLIC_KEY from ui-release-public-key.ts, while the release signer
   reads the same key out of that file's text with a regex (readReleasePublicKey in
   scripts/sign-ui-bundle.mjs) and refuses to sign with a key whose public half differs from it.
   This test hands the module's own text to the signer's reader and expects the key the app
   trusts, so a change to the file that one side follows and the other does not fails here
   instead of in the signing job. */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readReleasePublicKey } from '../../scripts/sign-ui-bundle.mjs';
import { RELEASE_UI_PUBLIC_KEY } from './ui-release-public-key';

const PUBLIC_KEY_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui-release-public-key.ts');

describe('ui-release-public-key.ts', () => {
  it('holds the key the release signer reads from its text', () => {
    expect(readReleasePublicKey(readFileSync(PUBLIC_KEY_FILE, 'utf8'))).toBe(RELEASE_UI_PUBLIC_KEY);
  });
});
