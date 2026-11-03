import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { canPreviewDocument, documentPreviewKinds, documentPreviewType } from './kinds';

const TYPES = ['xlsx', 'docx', 'pptx', 'pdf'];
const EVERY_RENDERER = TYPES.map((type) => `./renderers/${type}/render.ts`);
const PREVIEW_HOST = { supportsDocumentPreview: true };

function card(path, extra = {}) {
  return { path, draftUrl: `/api/v1/artifacts/drafts/local/abc/${path}`, ...extra };
}

describe('documentPreviewType', () => {
  it('maps no type while the build has no renderer', () => {
    const kinds = documentPreviewKinds([]);
    for (const type of TYPES) {
      expect(kinds.documentPreviewType(card(`report.${type}`))).toBeNull();
    }
  });

  it('maps a type once its render.ts exists, and only that type', () => {
    const kinds = documentPreviewKinds(['./renderers/xlsx/render.ts']);
    expect(kinds.documentPreviewType(card('report.xlsx'))).toBe('xlsx');
    expect(kinds.documentPreviewType(card('report.docx'))).toBeNull();
    expect(kinds.documentPreviewType(card('report.pptx'))).toBeNull();
    expect(kinds.documentPreviewType(card('report.pdf'))).toBeNull();
  });

  it('maps every type when every renderer exists', () => {
    const kinds = documentPreviewKinds(EVERY_RENDERER);
    for (const type of TYPES) {
      expect(kinds.documentPreviewType(card(`out/report.${type}`))).toBe(type);
    }
  });

  it('reads extensions without regard to case', () => {
    const kinds = documentPreviewKinds(EVERY_RENDERER);
    expect(kinds.documentPreviewType(card('REPORT.XLSX'))).toBe('xlsx');
    expect(kinds.documentPreviewType({ ext: '.PDF' })).toBe('pdf');
    expect(kinds.documentPreviewType({ canonicalPath: '/w/Deck.PpTx' })).toBe('pptx');
  });

  it('prefers the declared ext over the path, as the viewer does', () => {
    const kinds = documentPreviewKinds(EVERY_RENDERER);
    expect(kinds.documentPreviewType({ ext: '.docx', path: 'notes.txt' })).toBe('docx');
    expect(kinds.documentPreviewType({ ext: '.txt', path: 'notes.docx' })).toBeNull();
  });

  it.each(['.doc', '.ppt', '.xlsm', '.zip', '.json', '.parquet'])(
    'never maps %s, even with a renderer folder of that name',
    (ext) => {
      const kinds = documentPreviewKinds([...EVERY_RENDERER, `./renderers/${ext.slice(1)}/render.ts`]);
      expect(kinds.documentPreviewType(card(`data${ext}`))).toBeNull();
      expect(kinds.documentPreviewType({ ext })).toBeNull();
    },
  );

  it('ignores glob keys that are not a renderer entry', () => {
    const kinds = documentPreviewKinds(['./renderers/xlsx/grid.ts', './renderers/render.ts']);
    expect(kinds.documentPreviewType(card('report.xlsx'))).toBeNull();
  });

  it('gives null for a missing artifact or a file with no extension', () => {
    const kinds = documentPreviewKinds(EVERY_RENDERER);
    expect(kinds.documentPreviewType(null)).toBeNull();
    expect(kinds.documentPreviewType(undefined)).toBeNull();
    expect(kinds.documentPreviewType(card('Makefile'))).toBeNull();
  });
});

describe('canPreviewDocument', () => {
  const kinds = documentPreviewKinds(['./renderers/xlsx/render.ts']);

  it('is true for a draft with a renderer on a shell that supports the frame', () => {
    expect(kinds.canPreviewDocument(card('report.xlsx'), PREVIEW_HOST)).toBe(true);
  });

  it('is false for a full-stack app', () => {
    const app = card('report.xlsx', { type: 'fullstack-stateless-app' });
    expect(kinds.canPreviewDocument(app, PREVIEW_HOST)).toBe(false);
  });

  it('is false without a draftUrl', () => {
    expect(kinds.canPreviewDocument({ path: 'report.xlsx', serveUrl: '/serve/report.xlsx' }, PREVIEW_HOST)).toBe(false);
    expect(kinds.canPreviewDocument(null, PREVIEW_HOST)).toBe(false);
  });

  it('is false when the shell does not support the frame', () => {
    expect(kinds.canPreviewDocument(card('report.xlsx'), { supportsDocumentPreview: false })).toBe(false);
  });

  it('is false for a type with no renderer', () => {
    expect(kinds.canPreviewDocument(card('report.docx'), PREVIEW_HOST)).toBe(false);
  });
});

describe('the module gates', () => {
  it('map a type exactly when renderers/<type>/render.ts exists in this tree', () => {
    for (const type of TYPES) {
      const hasRenderer = existsSync(join(__dirname, 'renderers', type, 'render.ts'));
      expect(documentPreviewType(card(`report.${type}`))).toBe(hasRenderer ? type : null);
      expect(canPreviewDocument(card(`report.${type}`), PREVIEW_HOST)).toBe(hasRenderer);
    }
  });

  it('never map a file outside the four types', () => {
    expect(documentPreviewType(card('archive.zip'))).toBeNull();
    expect(canPreviewDocument(card('archive.zip'), PREVIEW_HOST)).toBe(false);
  });
});
