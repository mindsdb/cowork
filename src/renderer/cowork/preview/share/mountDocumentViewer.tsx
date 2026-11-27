/*
 * The viewer a shared document's page loads (ENG-4687): the app's own
 * document preview frame and renderer bundle, on a published page.
 *
 * cowork-server writes the page for a shared .docx, .pptx or .xlsx file
 * (cowork/services/file_page.py). It holds the file's text, which shows on its
 * own, and a mount element naming the file published beside the page:
 *
 *   <div data-cowork-document="deck.pptx" data-cowork-document-type="pptx"></div>
 *   <script src="https://<cowork web>/document-viewer/v1/pptx.js"></script>
 *
 * The script (built per type by scripts/document-viewer.mjs from entry.ts)
 * fetches that file from the page's own origin, reads it under the app's byte
 * cap and mounts DocumentPreviewFrame, the sandboxed frame the app's preview
 * uses, with the same renderer. The page's <html> carries the viewer's state
 * in data-cowork-document-viewer (VIEWER_STATE), so the page's CSS shows the preview
 * while it loads and once it renders, and the file's text again if it fails.
 * A page whose script never loads keeps showing the text.
 */
import { createRoot } from 'react-dom/client';

import type { DocumentPreviewType } from '../contract';
import { DocumentPreviewFrame } from '../DocumentPreviewFrame';
import { PREVIEW_PARENT_LIMITS } from '../limits';
import type { LoadedPreviewBundle } from '../runtime/bundle';
import { readPreviewBytes } from '../runtime/readBytes';

/* The page's <html> attribute, and its values, the page's CSS keys on. */
export const VIEWER_STATE_ATTRIBUTE = 'data-cowork-document-viewer';
export const VIEWER_STATE = Object.freeze({ loading: 'loading', rendered: 'rendered', failed: 'failed' });

/* The mount element's attributes: the published file's name beside the page,
   and its type. */
export const MOUNT_SELECTOR = '[data-cowork-document]';

/* A file name beside the page: one path segment, no leading dot. */
const SIBLING_FILE = /^[^/\\?#]+$/;

export interface ViewerBundle extends LoadedPreviewBundle { type: DocumentPreviewType }

export interface MountOptions {
  bundle: ViewerBundle;
  fetchFile?: (url: string, signal: AbortSignal) => Promise<Response>;
}

function setState(doc: Document, state: string) {
  doc.documentElement.setAttribute(VIEWER_STATE_ATTRIBUTE, state);
}

/*
 * Mounts the preview in `element`. Resolves once the file is in the frame, or
 * once the viewer gave up (the page shows the file's text again). It never
 * rejects: a page whose viewer fails is the page without it.
 */
export async function mountDocumentViewer(element: HTMLElement, { bundle, fetchFile = defaultFetch }: MountOptions): Promise<void> {
  const doc = element.ownerDocument;
  const file = element.getAttribute('data-cowork-document') || '';
  const type = element.getAttribute('data-cowork-document-type');
  if (!SIBLING_FILE.test(file) || file.startsWith('.') || type !== bundle.type) {
    setState(doc, VIEWER_STATE.failed);
    return;
  }
  setState(doc, VIEWER_STATE.loading);
  let bytes: ArrayBuffer;
  // Nothing cancels a page's one load; the fetch and the capped read share it.
  const { signal } = new AbortController();
  try {
    const url = new URL(encodeURIComponent(file), doc.baseURI).href;
    const response = await fetchFile(url, signal);
    if (!response.ok) throw new Error(`The file answered ${response.status}`);
    bytes = await readPreviewBytes(response, PREVIEW_PARENT_LIMITS.maxBytes, signal);
  } catch {
    setState(doc, VIEWER_STATE.failed);
    return;
  }
  const root = createRoot(element);
  const fail = () => {
    root.unmount();
    setState(doc, VIEWER_STATE.failed);
  };
  root.render(
    <DocumentPreviewFrame
      previewType={bundle.type}
      bytes={bytes}
      bundle={bundle}
      title={file}
      onRendered={() => setState(doc, VIEWER_STATE.rendered)}
      onError={fail}
    />,
  );
}

function defaultFetch(url: string, signal: AbortSignal): Promise<Response> {
  return fetch(url, { signal, credentials: 'same-origin' });
}
