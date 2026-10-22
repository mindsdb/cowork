import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PreviewErrorCode } from './contract';
import { isPreviewError, isPreviewErrorCode, PREVIEW_ERROR_CODES, previewError } from './errors';

const CODES: PreviewErrorCode[] = ['too-large', 'zip-limit', 'parse-failed', 'unsupported', 'timeout', 'internal'];

describe('PREVIEW_ERROR_CODES', () => {
  it('holds every code', () => {
    expect(Object.keys(PREVIEW_ERROR_CODES).sort()).toEqual([...CODES].sort());
  });

  it('is frozen, so no importer can change the codes for the others', () => {
    expect(Object.isFrozen(PREVIEW_ERROR_CODES)).toBe(true);
  });
});

describe('isPreviewErrorCode', () => {
  it.each(CODES)('accepts %s', (code) => {
    expect(isPreviewErrorCode(code)).toBe(true);
  });

  it.each([
    ['an unknown code', 'not-a-code'],
    ['a code in another case', 'TIMEOUT'],
    ['an empty string', ''],
    ['an inherited name', 'toString'],
    ['another inherited name', 'constructor'],
    ['the prototype key', '__proto__'],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(isPreviewErrorCode(value)).toBe(false);
  });
});

describe('previewError', () => {
  it('builds an Error named PreviewError that carries the code and message', () => {
    const error = previewError('unsupported', 'This PDF needs a password.');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'PreviewError', code: 'unsupported', message: 'This PDF needs a password.' });
    expect(isPreviewError(error)).toBe(true);
  });

  it('uses the code as the message when none is given', () => {
    expect(previewError('zip-limit').message).toBe('zip-limit');
  });

  it('keeps the cause it is given', () => {
    const cause = new Error('the library threw');
    expect(previewError('parse-failed', 'This file is not a readable PDF.', { cause }).cause).toBe(cause);
  });
});

describe('isPreviewError', () => {
  it('accepts an Error with a known code that another factory built', () => {
    expect(isPreviewError(Object.assign(new Error('cut short'), { code: 'zip-limit' }))).toBe(true);
  });

  it.each([
    ['an Error without a code', new Error('plain')],
    ['an Error with an unknown code', Object.assign(new Error('odd'), { code: 'not-a-code' })],
    ['an object that is not an Error', { name: 'PreviewError', code: 'internal', message: 'internal' }],
    ['a code on its own', 'internal'],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(isPreviewError(value)).toBe(false);
  });
});

describe('errors.ts imports', () => {
  it('imports only types from contract.ts, so the frame bundle and Node can load it', () => {
    const source = readFileSync(join(__dirname, 'errors.ts'), 'utf8');
    const imports = source.match(/^import\b.*$/gm) ?? [];
    expect(imports).not.toEqual([]);
    for (const line of imports) expect(line).toMatch(/^import type \{[^}]*\} from '\.\/contract';$/);
    expect(source).not.toMatch(/import\.meta|\bimport\s*\(|\brequire\s*\(/);
  });
});
