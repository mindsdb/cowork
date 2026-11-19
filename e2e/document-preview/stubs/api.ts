/*
 * The file viewer page's stand-in for the names ContextFileModal imports from
 * src/renderer/cowork/api.js. The page opens an upload by its raw URL, so no
 * project file call should run; each one throws to say so.
 */
const noProjectFiles = async (): Promise<never> => {
  throw new Error('The file viewer harness opens uploads only; it has no project files.');
};

export const readProjectFile = noProjectFiles;
export const writeProjectFile = noProjectFiles;
export const deleteProjectFile = noProjectFiles;
export const mountProjectFilePreview = noProjectFiles;

export function projectFileDownloadUrl(projectName: string, path: string): string {
  return `/projects/${encodeURIComponent(projectName)}/files-raw/${path}`;
}

export const ANTON_PROJECT_INSTRUCTIONS_PATH = '.anton/anton.md';
