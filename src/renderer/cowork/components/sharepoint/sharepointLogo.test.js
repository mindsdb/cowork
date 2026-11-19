import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The picker tile and the connection card load `logos/sharepoint.svg` (the
// spec's logo_url and `logos/${engine}.svg`), so the file must be a real SVG.
const LOGO = path.resolve(__dirname, '../../../public/logos/sharepoint.svg');

describe('SharePoint logo', () => {
  it('is a well-formed SVG with nothing but drawing in it', () => {
    const text = readFileSync(LOGO, 'utf8');
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');

    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.tagName.toLowerCase()).toBe('svg');
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(doc.querySelectorAll('script, foreignObject, image').length).toBe(0);
    expect(text).not.toMatch(/\son[a-z]+=|href=/i);
  });
});
