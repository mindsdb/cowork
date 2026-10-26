import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import type { PreviewErrorCode } from './contract';
import {
  isPreviewError,
  isPreviewErrorCode,
  isPreviewFailureLimit,
  PREVIEW_ERROR_CODES,
  PREVIEW_FAILURE_LIMITS,
  previewError,
} from './errors';

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

  it('carries the limit it names, and the cause, and no limit key when it names none', () => {
    const cause = new Error('inner');
    const error = previewError('too-large', 'Too many nodes.', { limit: 'maxDocxNodes', cause });
    expect(error).toMatchObject({ code: 'too-large', limit: 'maxDocxNodes', cause });
    expect(previewError('parse-failed', 'bad', { cause })).not.toHaveProperty('limit');
  });
});

describe('isPreviewFailureLimit', () => {
  it('accepts each limit whose breach ends a preview, and nothing else', () => {
    for (const limit of Object.keys(PREVIEW_FAILURE_LIMITS)) expect(isPreviewFailureLimit(limit)).toBe(true);
    for (const value of ['maxSheets', 'toString', '', undefined, 1]) expect(isPreviewFailureLimit(value)).toBe(false);
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
  it('imports and re-exports only types from contract.ts, so the frame bundle and Node can load it', () => {
    const source = readFileSync(join(__dirname, 'errors.ts'), 'utf8');
    /* Every module errors.ts reaches: imports, re-exports, side-effect imports, dynamic import() and require(). */
    const modules = ts.preProcessFile(source, true, true).importedFiles.map((imported) => imported.fileName);
    expect(modules).toEqual(['./contract']);
    /* That one module is reached only through a type-only import, so nothing of it is left at run time. */
    const file = ts.createSourceFile('errors.ts', source, ts.ScriptTarget.Latest);
    const reachesModule = (statement: ts.Statement) =>
      ts.isImportDeclaration(statement) || (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined);
    const isTypeOnlyImport = (statement: ts.Statement) =>
      ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly === true;
    expect(file.statements.filter(reachesModule).every(isTypeOnlyImport)).toBe(true);
    expect(source).not.toMatch(/import\.meta/);
  });
});
