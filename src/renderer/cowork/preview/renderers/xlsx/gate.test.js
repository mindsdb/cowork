/*
 * The preview gate in kinds.js finds this folder's render.ts on its own, so
 * .xlsx turns previewable with no edit outside renderers/xlsx/.
 */
import { describe, expect, it } from 'vitest';

import { canPreviewDocument, documentPreviewType } from '../../kinds';

const CARD = { path: 'out/report.xlsx', draftUrl: '/api/v1/artifacts/drafts/local/abc/out/report.xlsx' };

describe('the preview gate with the xlsx renderer in the tree', () => {
  it('maps an .xlsx card to the xlsx preview', () => {
    expect(documentPreviewType(CARD)).toBe('xlsx');
  });

  it('opens an .xlsx draft in the preview on a shell that supports the frame', () => {
    expect(canPreviewDocument(CARD, { supportsDocumentPreview: true })).toBe(true);
  });

  it('still leaves an .xlsx closed on a shell without the frame', () => {
    expect(canPreviewDocument(CARD, { supportsDocumentPreview: false })).toBe(false);
  });
});
