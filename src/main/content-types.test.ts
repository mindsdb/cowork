import { describe, expect, it } from 'vitest';
import { CONTENT_TYPES, contentTypeFor } from './content-types';

describe('contentTypeFor', () => {
  it('gives a module script a JavaScript type, so the window and the lint page can load it', () => {
    expect(contentTypeFor('/cache/current/assets/index-BdK3x9.js')).toBe('text/javascript');
    expect(contentTypeFor('chunk.mjs')).toBe('text/javascript');
  });

  it('reads the extension in any case', () => {
    expect(contentTypeFor('page.HTML')).toBe('text/html');
    expect(contentTypeFor('C:\\cache\\current\\Logo.SVG')).toBe('image/svg+xml');
  });

  it('serves a file with an unknown extension, or none, as application/octet-stream', () => {
    expect(contentTypeFor('data.bin')).toBe('application/octet-stream');
    expect(contentTypeFor('LICENSE')).toBe('application/octet-stream');
    expect(contentTypeFor('archive.tar.gz')).toBe('application/octet-stream');
  });

  it('keys every entry by a lowercase extension with its dot', () => {
    for (const extension of Object.keys(CONTENT_TYPES)) {
      expect(extension).toMatch(/^\.[a-z0-9]+$/);
    }
  });
});
