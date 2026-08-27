import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The web SPA is served over http with a `/` base and has deep client-side
// routes (`/c/:id`, `/projects/:id`). A `./`-relative asset ref in the entry
// HTML resolves against the *route* path, so a deep-route refresh requests e.g.
// `/c/web-main.tsx` → 404 → blank screen (ENG-1233). Every asset must be
// root-absolute. (The Electron entry `index.html` is deliberately the opposite:
// it loads over file://, so it uses `./`.)
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
