import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/* The web build boots from web-main.tsx and the desktop app from main.tsx, and
 * each imports the global stylesheets itself. One the web entry leaves out
 * styles nothing on the web: without KaTeX's, each formula shows its MathML
 * copy as plain text beside the rendered math. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylesheets = (entry: string): string[] =>
  [...readFileSync(path.resolve(__dirname, entry), 'utf-8').matchAll(/^import '([^']+\.css)';$/gm)].map((m) => m[1]);

describe('web-main.tsx stylesheets', () => {
  it('loads every stylesheet the desktop entry loads', () => {
    expect(new Set(stylesheets('web-main.tsx'))).toEqual(new Set(stylesheets('main.tsx')));
  });

  it("loads KaTeX's stylesheet before globals.css, so the global math tweaks win", () => {
    const web = stylesheets('web-main.tsx');
    expect(web.indexOf('katex/dist/katex.min.css')).toBeGreaterThan(-1);
    expect(web.indexOf('katex/dist/katex.min.css')).toBeLessThan(web.indexOf('./cowork/styles/globals.css'));
  });
});
