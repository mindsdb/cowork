import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The main window reads every file of the UI cache through the file:// handler
 * (ui-file-protocol.ts), which serves a file only when its bytes match the
 * manifest verified before the load. In Electron 45, a dedicated or shared
 * worker's script does not go through session.protocol.handle('file'), so a
 * worker script in the cache would be checked only by the folder check before
 * the load, and a file changed after it would run in the worker unchecked.
 * Today's renderer creates no worker. This scans the renderer's sources and
 * fails on a Worker or SharedWorker constructor and on a Vite worker import
 * (`?worker`, `?sharedworker`), so adding one starts with covering worker
 * scripts first.
 */

const REPO = path.resolve(__dirname, '../..');
const RENDERER = 'src/renderer';
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html'];

/* What creates a worker: `new Worker(`, `new SharedWorker(`, with a qualifier
   such as `window.` too, and a Vite import whose query asks for a worker. */
const WORKER_PATTERNS: readonly RegExp[] = [
  /\bnew\s+(?:[\w$]+\s*\.\s*)*(?:Shared)?Worker\s*\(/g,
  /['"`][^'"`\n]*\?(?:shared)?worker\b[^'"`\n]*['"`]/g,
];

/* The renderer's source files, without its tests, which never ship. */
function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(REPO, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(relative);
    const isSource = SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension));
    const isTest = /\.(?:test|spec)\.[^.]+$/.test(entry.name);
    return isSource && !isTest ? [relative.split(path.sep).join('/')] : [];
  });
}

/* Every `<label>:<line>` in this text where a worker pattern matches. */
function workersIn(label: string, text: string): string[] {
  return WORKER_PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => `${label}:${text.slice(0, match.index).split('\n').length}`));
}

describe('workers in the renderer', () => {
  it('matches what creates a worker and skips names that only end in Worker', () => {
    for (const line of [
      'const w = new Worker(url);',
      'new SharedWorker(new URL("./w.js", import.meta.url))',
      'new window.Worker(url)',
      'new globalThis . SharedWorker (url)',
      "import Parser from './parser?worker';",
      'import Parser from "./parser?worker&inline";',
      "const Shared = await import('./shared?sharedworker');",
    ]) {
      expect(workersIn('sample', line), line).toEqual(['sample:1']);
    }
    for (const line of [
      'new GenericWorker(url)',
      'this._compressWorker = worker;',
      "import raw from './worker.js?raw';",
      'const workerCount = 2;',
    ]) {
      expect(workersIn('sample', line), line).toEqual([]);
    }
  });

  it("creates none, since the file:// handler never sees a worker's script in Electron 45", () => {
    const files = sourceFiles(RENDERER);
    expect(files.length).toBeGreaterThan(100);
    const found = files.flatMap((file) => workersIn(file, readFileSync(path.join(REPO, file), 'utf-8')));
    expect(
      found,
      "A worker script does not go through the main window's file:// handler (ui-file-protocol.ts) in Electron 45, " +
        'so a worker loaded from the UI cache would run a file changed after the folder check unchecked. ' +
        'Cover worker scripts with a check at read time before adding a worker.',
    ).toEqual([]);
  });
});
