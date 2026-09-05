import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Web assets need root-absolute URLs for deep routes; Electron's file entry needs relative URLs.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.resolve(__dirname, 'index-web.html'), 'utf-8');

describe('index-web.html asset paths (ENG-1233 deep-route refresh)', () => {
  it('references every asset root-absolute, never `./`-relative', () => {
    const relative = [...html.matchAll(/(?:src|href)="(\.[^"]*)"/g)].map((m) => m[1]);
    expect(relative).toEqual([]);
  });

  it('loads the web entry module and gravity-field from root', () => {
    expect(html).toContain('src="/web-main.tsx"');
    expect(html).toContain('src="/gravity-field/gravity-field.js"');
    expect(html).toContain('href="/gravity-field/gravity-field.css"');
  });
});
