import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/*
 * Electron 46 removes safeStorage's synchronous methods. A call left in the
 * main process would throw there, and the token store would quietly stop
 * keeping the session across launches. This fails on any mention of the
 * removed names in main-process sources, whatever form the call takes.
 */

const REPO = path.resolve(__dirname, '../..');
const REMOVED = ['encryptString', 'decryptString', 'isEncryptionAvailable'];

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(REPO, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [relative] : [];
  });
}

/* Every `<label>:<line>:<name>` where a removed name appears as a whole word.
   The Async variants are longer words and do not match. */
function mentionsIn(label: string, text: string): string[] {
  const named = new RegExp(`\\b(?:${REMOVED.join('|')})\\b`, 'g');
  return [...text.matchAll(named)].map((match) => `${label}:${text.slice(0, match.index).split('\n').length}:${match[0]}`);
}

describe('safeStorage synchronous API', () => {
  it('sees a removed method however it is reached', () => {
    const sample = [
      'safeStorage.encryptString(a);',
      'const { decryptString } = safeStorage;',
      "safeStorage['isEncryptionAvailable']();",
      'await safeStorage.encryptStringAsync(a);',
      'await safeStorage.isAsyncEncryptionAvailable();',
    ].join('\n');
    expect(mentionsIn('sample.ts', sample)).toEqual([
      'sample.ts:1:encryptString',
      'sample.ts:2:decryptString',
      'sample.ts:3:isEncryptionAvailable',
    ]);
  });

  it('is not used anywhere in the main process', () => {
    const found = sourceFiles('src/main').flatMap((file) =>
      mentionsIn(file.split(path.sep).join('/'), readFileSync(path.join(REPO, file), 'utf-8')));
    expect(found).toEqual([]);
  });
});
