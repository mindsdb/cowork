/*
 * The viewer's Export button: which formats it lists, the export itself, the
 * save of the new file and the message each answer shows.
 *
 * The export route writes the new file beside the artifact's primary file and
 * answers with the file's name and URLs. Only a 200 writes a file. The formats
 * come from the server's `exportFormats`, so an older server, which sends
 * none, shows no Export at all.
 */
import { host } from '../../platform/host';
import { downloadArtifactFile } from './artifactDownload';
import { requestArtifactExport } from './artifactWorkspaceApi';

/** @typedef {import('../components/artifact').ArtifactExportFormat} ArtifactExportFormat */
/** @typedef {import('../components/artifact').ArtifactExportResult} ArtifactExportResult */
/** @typedef {import('../components/artifact').ArtifactCapabilities} ArtifactCapabilities */

/**
 * What the button shows once an export settles: `info` for a saved file that
 * left references out, `error` for an export or a save that didn't happen.
 *
 * @typedef {{ tone: 'info' | 'error', text: string }} ExportNotice
 */

/** @type {ReadonlyMap<ArtifactExportFormat, string>} */
export const EXPORT_FORMAT_LABELS = new Map([
  ['html', 'HTML'],
  ['docx', 'Word'],
  ['pdf', 'PDF'],
]);

const CANNOT_EXPORT = "This file can't be exported.";

/** @type {ReadonlyMap<number, string>} */
const FAILURE_MESSAGES = new Map([
  [413, CANNOT_EXPORT],
  [422, CANNOT_EXPORT],
  [429, 'An export is already running; try again in a moment.'],
  [503, 'PDF export is busy; try again.'],
  [504, 'PDF export took too long.'],
]);

/** The message for any failed answer without its own row, and for no answer at all. */
const EXPORT_FAILED = "Couldn't export this file.";

/**
 * The formats Export lists, in the server's order. The workspace route
 * rechecks who may edit (cowork-server's `_current_capabilities`), so its list
 * wins even when it is empty; the card's list covers a workspace that hasn't
 * answered yet, or holds only the viewer's own guess of the capabilities. A
 * value this build has no label for is left out.
 *
 * @param {{ capabilities?: ArtifactCapabilities | null } | null | undefined} workspace
 * @param {{ capabilities?: ArtifactCapabilities | null } | null | undefined} artifact
 * @returns {ArtifactExportFormat[]}
 */
export function artifactExportFormats(workspace, artifact) {
  const formats = workspace?.capabilities?.exportFormats ?? artifact?.capabilities?.exportFormats;
  return Array.isArray(formats) ? formats.filter((format) => EXPORT_FORMAT_LABELS.has(format)) : [];
}

/**
 * @param {number | undefined} status
 * @returns {string}
 */
function exportFailureMessage(status) {
  return FAILURE_MESSAGES.get(status) ?? EXPORT_FAILED;
}

/**
 * The note for a written file that left references out, or '' for none.
 *
 * @param {number} count
 * @returns {string}
 */
function omittedReferencesMessage(count) {
  if (!(count > 0)) return '';
  return count === 1
    ? '1 item outside this artifact was left out.'
    : `${count} items outside this artifact were left out.`;
}

/**
 * Saves the exported file and resolves whether it saved. Web hands over the
 * draft URL alone, so the save goes through the authenticated drafts route.
 * Desktop saves through the serve URL, and through the drafts route when the
 * server sent an empty one.
 *
 * @param {ArtifactExportResult} result
 * @returns {Promise<boolean>}
 */
export async function saveExportedFile(result) {
  const file = host.isWeb
    ? { draftUrl: result.draftUrl }
    : { serveUrl: result.serveUrl, draftUrl: result.draftUrl };
  return downloadArtifactFile(file, { actionPath: result.filename });
}

/**
 * Runs one export and saves the new file. Resolves the notice to show, or
 * null when the file saved with nothing left out. Never rejects.
 *
 * @param {string} draftUrl the artifact card's draft URL, which names the artifact
 * @param {ArtifactExportFormat} format
 * @returns {Promise<ExportNotice | null>}
 */
export async function runArtifactExport(draftUrl, format) {
  let result;
  try {
    result = await requestArtifactExport(draftUrl, format);
  } catch (error) {
    return { tone: 'error', text: exportFailureMessage(error?.status) };
  }
  /* The note describes the written file, so a failed save still carries it. */
  const omitted = omittedReferencesMessage(result.omittedCount);
  const saved = await saveExportedFile(result).catch(() => false);
  if (!saved) {
    const notSaved = `Exported ${result.filename}, but couldn't download it.`;
    return { tone: 'error', text: [notSaved, omitted].filter(Boolean).join(' ') };
  }
  return omitted ? { tone: 'info', text: omitted } : null;
}
