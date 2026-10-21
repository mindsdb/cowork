import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PREVIEW_FRAME_NAME as SHARED_FRAME_NAME } from '../../../shared/document-preview';
import {
  PREVIEW_FRAME_NAME,
  PREVIEW_SANDBOX,
  previewFramePolicy,
} from './frameDocument';

/* The base64 sha256 of an empty script. */
const HASH = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';

/* The frame policy as the spec writes it, with a placeholder for the script hash. */
const POLICY_TEXT = "default-src 'none'; script-src 'sha256-<renderer bundle hash>'; style-src 'unsafe-inline'; img-src blob: data:; font-src data:; media-src 'none'; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'";

describe('frame constants', () => {
  it('sandboxes the frame with scripts only', () => {
    expect(PREVIEW_SANDBOX).toBe('allow-scripts');
  });

  it('names the frame with the constant the main process imports', () => {
    expect(PREVIEW_FRAME_NAME).toBe('cowork-document-preview');
    expect(PREVIEW_FRAME_NAME).toBe(SHARED_FRAME_NAME);
  });
});

describe('previewFramePolicy', () => {
  it('pins the policy byte for byte', () => {
    expect(previewFramePolicy(HASH)).toBe(POLICY_TEXT.replace('<renderer bundle hash>', HASH));
  });

  it.each([
    ['an empty digest', ''],
    ['a hex digest', 'a'.repeat(64)],
    ['a digest without padding', HASH.slice(0, -1)],
    ['a directive spliced after the digest', `${HASH}'; script-src *; '`],
  ])('throws on %s', (_label, digest) => {
    expect(() => previewFramePolicy(digest)).toThrow('base64 sha256');
  });
});

describe('frameDocument.ts imports', () => {
  it('imports nothing Vite-only, so Node and the Electron spec can load it', () => {
    const source = readFileSync(join(__dirname, 'frameDocument.ts'), 'utf8');
    expect(source).not.toMatch(/import\.meta/);
    expect(source).not.toMatch(/\?(raw|url|worker|inline)['"]/);
    expect(source).not.toMatch(/['"]virtual:/);
  });
});
