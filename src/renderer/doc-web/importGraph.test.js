// The editor on a shared doc's page runs on the content host, as a viewer
// signed in to MindsHub. It must never reach the desktop bridge
// (platform/host) or the app's API client (cowork/api): both assume the app's
// own origin and credentials, and a convenient import from either would carry
// them onto the page. Walks the bundle's relative imports from its entry.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'src/renderer');
const ENDINGS = ['', '.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx', '/index.ts', '/index.tsx'];
const IMPORT = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveImport(from, spec) {
  const base = resolve(dirname(from), spec);
  // A TS module imported by its .js/.jsx name, as Vite allows.
  const candidates = [...ENDINGS.map((e) => base + e), base.replace(/\.jsx?$/, '.tsx'), base.replace(/\.js$/, '.ts')];
  return candidates.find((p) => existsSync(p) && statSync(p).isFile());
}

function importGraph(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.[jt]sx?$/.test(file)) continue;
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(IMPORT)) {
      const spec = m[1] || m[2] || m[3];
      if (!spec.startsWith('.')) continue;
      const hit = resolveImport(file, spec);
      // Fail rather than skip: an import this walk misses is one it cannot vouch for.
      if (!hit) throw new Error(`${relative(ROOT, file)}: cannot resolve ${spec}`);
      stack.push(hit);
    }
  }
  return [...seen].map((f) => relative(ROOT, f)).sort();
}

describe('the shared page editor\'s imports', () => {
  const graph = importGraph(resolve(ROOT, 'doc-web/entry.js'));

  it('are walked through to the doc editor it is built from', () => {
    expect(graph).toContain('cowork/components/doc/DocCanvas.jsx');
    expect(graph).toContain('cowork/components/doc/useDoc.js');
  });

  it('never reach the desktop bridge or the app\'s API client', () => {
    expect(graph.filter((f) => /^(platform\/host|cowork\/api)\.[jt]sx?$/.test(f))).toEqual([]);
  });
});
