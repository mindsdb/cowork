import { useEffect, useState } from 'react';
import { host } from '../../../../platform/host';
import { inlineHtmlFromApi } from '../../../lib/inlineHtmlAssets';
import {
  canFetchDraftWithCredentials,
  draftDirectoryUrl,
  draftFileName,
  isAbsoluteArtifactPreviewUrl,
} from '../artifactPreviewUtils';

/*
 * The HTML editor and the revision comparison show a draft from `srcdoc`. Its
 * own requests for files beside it carry no credential, and on desktop they
 * resolve against the shell's file:// URL. So those files are read with the
 * viewer's credential and put inside the document, as the web Preview does.
 */

/** The draft's URL on the API origin; '' when there is none. */
export function absoluteDraftUrl(draftUrl) {
  if (!draftUrl) return '';
  return isAbsoluteArtifactPreviewUrl(draftUrl) ? draftUrl : `${host.getApiOrigin()}${draftUrl}`;
}

// Only our own API may receive the credential: data:/blob: and other origins
// are left as they are, as Preview leaves them.
function canInline(documentUrl) {
  return !!documentUrl && canFetchDraftWithCredentials(documentUrl, host.getApiOrigin());
}

/**
 * @param {string} html the document to show, already built for the frame
 * @param {string} documentUrl its absolute URL (`absoluteDraftUrl`)
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<string>} the document with its folder files inlined, or
 *   `html` unchanged when nothing may or could be inlined; never rejects
 */
export async function inlineArtifactFrameDocument(html, documentUrl, { signal } = {}) {
  if (!canInline(documentUrl)) return html;
  try {
    return await inlineHtmlFromApi(html, {
      rootUrl: draftDirectoryUrl(documentUrl),
      filePath: draftFileName(documentUrl),
      signal,
      chatWorkspaces: false,
    });
  } catch {
    return html;
  }
}

/**
 * `content` is null while the run for the current input is in flight. The
 * result is kept with the input it was made for, so no render after an input
 * change hands the frame the previous document.
 *
 * @param {string} html
 * @param {string} documentUrl absolute (`absoluteDraftUrl`)
 * @returns {{ content: string | null, pending: boolean }}
 */
export function useInlinedFrameDocument(html, documentUrl) {
  const inline = canInline(documentUrl);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!inline) return undefined;
    const controller = new AbortController();
    inlineArtifactFrameDocument(html, documentUrl, { signal: controller.signal })
      .then((content) => {
        if (!controller.signal.aborted) setResult({ html, documentUrl, content });
      });
    return () => controller.abort();
  }, [html, documentUrl, inline]);

  if (!inline) return { content: html, pending: false };
  if (result && result.html === html && result.documentUrl === documentUrl) {
    return { content: result.content, pending: false };
  }
  return { content: null, pending: true };
}
