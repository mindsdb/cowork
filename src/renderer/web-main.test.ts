import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/* The web build boots from web-main.tsx and the desktop app from main.tsx, and
 * each imports the global stylesheets itself. One the web entry leaves out
 * styles nothing on the web. KaTeX's stylesheet is the exception: both builds
 * load it with the math code on first use (MarkdownContent's _loadKatex).
 * Without it each formula shows its MathML copy as plain text beside the
 * rendered math. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylesheets = (entry: string): string[] =>
  [...readFileSync(path.resolve(__dirname, entry), 'utf-8').matchAll(/^import '([^']+\.css)';$/gm)].map((m) => m[1]);

describe('web-main.tsx stylesheets', () => {
  it('loads every stylesheet the desktop entry loads', () => {
    expect(new Set(stylesheets('web-main.tsx'))).toEqual(new Set(stylesheets('main.tsx')));
  });

  it("loads KaTeX's stylesheet with the math, after globals.css, and the global math tweaks still win", () => {
    const read = (file: string) => readFileSync(path.resolve(__dirname, file), 'utf-8');
    expect(stylesheets('web-main.tsx')).not.toContain('katex/dist/katex.min.css');
    expect(read('cowork/components/markdown/MarkdownContent.jsx')).toContain("import('katex/dist/katex.min.css')");
    // KaTeX's rules start with `.katex`; ours are scoped under
    // `.markdown-content`, so they outrank KaTeX's whatever order they load in.
    const globals = read('cowork/styles/globals.css');
    expect(globals).toMatch(/^\.markdown-content \.katex \{/m);
    expect(globals).toMatch(/^\.markdown-content \.katex-display \{/m);
    expect(globals).not.toMatch(/^\.katex(-display)? \{/m);
  });
});
