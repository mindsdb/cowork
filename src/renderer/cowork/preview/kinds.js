/*
 * Which artifacts the viewer previews in the sandboxed document frame.
 *
 * A type is previewable once its renderer exists at renderers/<type>/render.ts,
 * so adding that one file is all a new type needs. Vite replaces a glob read
 * directly through Object.keys with an object of its file names, so nothing
 * under renderers/ is imported into the app bundle. The eager '?raw' options
 * keep that true if the glob is ever read another way: each match then inlines
 * as source text, never as a module with its libraries. The frame build
 * bundles the renderers on its own.
 *
 * The extension resolves the way the viewer resolves it for text previews: the
 * declared `ext` wins, then the canonical path.
 */
import { isBackendArtifact } from '../lib/artifactKinds';
import { artifactExtension } from '../components/artifact/artifactPreviewUtils';

/** @typedef {import('./contract').DocumentPreviewType} DocumentPreviewType */

/** @type {ReadonlyMap<string, DocumentPreviewType>} */
const PREVIEW_TYPE_BY_EXTENSION = new Map([
  ['.xlsx', 'xlsx'],
  ['.docx', 'docx'],
  ['.pptx', 'pptx'],
  ['.pdf', 'pdf'],
]);

const RENDERER_KEY = /^\.\/renderers\/([^/]+)\/render\.ts$/;

/**
 * Builds the two preview gates for a set of renderer files, named the way
 * import.meta.glob names them ('./renderers/xlsx/render.ts'). The module's
 * own gates come from the real glob; tests pass their own keys.
 *
 * @param {readonly string[]} rendererKeys
 */
export function documentPreviewKinds(rendererKeys) {
  const rendered = new Set(rendererKeys.map((key) => RENDERER_KEY.exec(key)?.[1]));

  /**
   * The preview type for an artifact's file, or null when the file isn't one
   * of the document types or the build has no renderer for it.
   *
   * @returns {DocumentPreviewType | null}
   */
  function documentPreviewType(a) {
    if (!a) return null;
    const ext = (a.ext || '').toLowerCase() || artifactExtension(a.canonicalPath || a.file_path || a.path);
    const type = PREVIEW_TYPE_BY_EXTENSION.get(ext);
    return type && rendered.has(type) ? type : null;
  }

  /**
   * The one gate every click surface asks before it opens a document preview.
   *
   * @param {{ supportsDocumentPreview: boolean }} host
   */
  function canPreviewDocument(a, host) {
    return !!a?.draftUrl && !isBackendArtifact(a) && documentPreviewType(a) !== null && host.supportsDocumentPreview;
  }

  return { documentPreviewType, canPreviewDocument };
}

export const { documentPreviewType, canPreviewDocument } = documentPreviewKinds(
  Object.keys(import.meta.glob('./renderers/*/render.ts', { eager: true, query: '?raw', import: 'default' })),
);
