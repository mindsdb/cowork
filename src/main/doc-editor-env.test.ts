import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { docEditorEnv } from './doc-editor-env';

const built = (dir: string) => (file: string) => file === path.join(dir, 'doc-editor.js');

describe('docEditorEnv', () => {
  it('points a packaged app\'s sidecar at the editor in resources/', () => {
    expect(docEditorEnv({ isPackaged: true, resourcesPath: '/App/Resources', distDir: '/repo/dist', exists: built('/App/Resources/doc-editor') }))
      .toEqual({ COWORK_DOC_EDITOR_DIR: path.join('/App/Resources', 'doc-editor') });
  });

  it('points a dev sidecar at the build output', () => {
    expect(docEditorEnv({ isPackaged: false, resourcesPath: '/electron/Resources', distDir: '/repo/dist', exists: built('/repo/dist/doc-editor') }))
      .toEqual({ COWORK_DOC_EDITOR_DIR: path.join('/repo/dist', 'doc-editor') });
  });

  it('adds nothing when the editor was not built: shared pages stay read-only', () => {
    expect(docEditorEnv({ isPackaged: false, distDir: '/repo/dist', exists: () => false })).toEqual({});
    expect(docEditorEnv({ isPackaged: true, resourcesPath: undefined, distDir: '/repo/dist', exists: () => true })).toEqual({});
  });

  it('leaves a developer\'s own COWORK_DOC_EDITOR_DIR alone', () => {
    expect(docEditorEnv({ preset: '/my/build', isPackaged: false, distDir: '/repo/dist', exists: () => true })).toEqual({});
  });
});
