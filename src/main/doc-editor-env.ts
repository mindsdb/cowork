// Where cowork-server finds the owner editor for shared docs' pages
// (npm run build:doc-editor): it copies doc-editor.{js,css} beside each doc's
// page, which publishes them with it. Packaged, the build ships unpacked in
// resources/ (an asar is unreadable to the sidecar); in dev it is dist/.

import * as path from 'path';

export interface DocEditorEnvInput {
  /** COWORK_DOC_EDITOR_DIR as already set: a developer's own pick, passed through untouched. */
  preset?: string;
  isPackaged: boolean;
  resourcesPath?: string;
  /** The dev build's output root (dist/). */
  distDir: string;
  exists: (file: string) => boolean;
}

/** The sidecar env entry naming the editor build, or nothing to add. */
export function docEditorEnv({ preset, isPackaged, resourcesPath, distDir, exists }: DocEditorEnvInput): Record<string, string> {
  if (preset) return {};
  const base = isPackaged ? resourcesPath : distDir;
  if (!base) return {};
  const dir = path.join(base, 'doc-editor');
  // Best effort: without the build, shared doc pages are simply read-only.
  return exists(path.join(dir, 'doc-editor.js')) ? { COWORK_DOC_EDITOR_DIR: dir } : {};
}
