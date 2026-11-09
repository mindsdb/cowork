/*
 * The preview gate in kinds.js finds this folder's render.ts on its own, so
 * .pdf turns previewable with no edit outside renderers/pdf/.
 */
import { describe, expect, it } from 'vitest';

import { canPreviewDocument, documentPreviewType } from '../../kinds';

const CARD = { path: 'out/report.pdf', draftUrl: '/api/v1/artifacts/drafts/local/abc/out/report.pdf' };

describe('the preview gate with the pdf renderer in the tree', () => {
  it('maps a .pdf card to the pdf preview', () => {
    expect(documentPreviewType(CARD)).toBe('pdf');
  });

  it('opens a .pdf draft in the preview on a shell that supports the frame', () => {
    expect(canPreviewDocument(CARD, { supportsDocumentPreview: true })).toBe(true);
  });

  it('still leaves a .pdf closed on a shell without the frame', () => {
    expect(canPreviewDocument(CARD, { supportsDocumentPreview: false })).toBe(false);
  });
});
