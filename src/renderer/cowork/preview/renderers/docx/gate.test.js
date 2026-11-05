/*
 * The preview gate in kinds.js finds this folder's render.ts on its own, so
 * .docx turns previewable with no edit outside renderers/docx/.
 */
import { describe, expect, it } from 'vitest';

import { canPreviewDocument, documentPreviewType } from '../../kinds';

const CARD = { path: 'out/report.docx', draftUrl: '/api/v1/artifacts/drafts/local/abc/out/report.docx' };

describe('the preview gate with the docx renderer in the tree', () => {
  it('maps a .docx card to the docx preview', () => {
    expect(documentPreviewType(CARD)).toBe('docx');
  });

  it('opens a .docx draft in the preview on a shell that supports the frame', () => {
    expect(canPreviewDocument(CARD, { supportsDocumentPreview: true })).toBe(true);
  });

  it('still leaves a .docx closed on a shell without the frame', () => {
    expect(canPreviewDocument(CARD, { supportsDocumentPreview: false })).toBe(false);
  });
});
