/* What a project upload's 200 answer says about the files it didn't save.
   cowork-server answers one result per file, and a file it refused (a
   dotfile, a failed write) comes back as `ok: false` in that list. */
import i18n, { formatList } from '../../lib/i18n';

/**
 * One file's result in a project upload's answer.
 *
 * @typedef {object} ProjectUploadResult
 * @property {string} name The file's name as the server saved or refused it.
 * @property {boolean} ok Whether the server saved the file.
 * @property {number} [size] The saved file's size in bytes.
 * @property {string} [error] The server's reason, in English, for a refused file.
 */

/**
 * The sentence that names the files a project upload didn't save, or '' when
 * it saved them all.
 *
 * @param {{ results?: ProjectUploadResult[] } | null | undefined} response
 * @returns {string}
 */
export function notUploadedSentence(response) {
  const results = Array.isArray(response?.results) ? response.results : [];
  const names = results.filter((result) => result?.ok === false).map((result) => result.name).filter(Boolean);
  if (!names.length) return '';
  return i18n.t('messages.projectUploads.notUploaded', { ns: 'projects', files: formatList(names) });
}
