// The docs API as DocPane's tests see it (`vi.mock('./docApi')`): every call a
// vi.fn, and the doc stream's handlers kept in `stream` for the test to drive.
import { vi } from 'vitest';

export const stream = { handlers: null };
export const fetchDoc = vi.fn();
export const postDocOps = vi.fn();
export const followDoc = vi.fn();
export const followConversationDocs = vi.fn(() => () => {});
export const downloadDocExport = vi.fn();
export const fetchDocMarkdown = vi.fn();
export const fetchDocHistory = vi.fn();
export const fetchDocVersion = vi.fn();
export const restoreDocVersion = vi.fn();

/** Forget every call and answer; the stream goes back to recording its handlers. */
export function resetDocApi() {
  for (const fn of [fetchDoc, postDocOps, followDoc, downloadDocExport, fetchDocMarkdown,
    fetchDocHistory, fetchDocVersion, restoreDocVersion]) fn.mockReset();
  stream.handlers = null;
  followDoc.mockImplementation((_p, _a, handlers) => { stream.handlers = handlers; return () => {}; });
}
