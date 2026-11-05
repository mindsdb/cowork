// Anton's `generate_image` tool (ENG-4024) writes the picture into the
// workspace and hands back where it put it, never the bytes:
//
//   {"path": "images/cat.png", "width": 1024, "height": 1024,
//    "mime_type": "image/png", "model": "gpt-image-2.6-flare", "usage": {...}}
//
// The stream adapter turns that result into an `Image` step and the chat shows
// the file inline, read through the project's files route like any other file
// the agent wrote. Pure helpers, so the parsing and the path rule are tested
// directly.

/** The tool's name on the wire (`tool_name` on its result event). */
export const GENERATE_IMAGE_TOOL = 'generate_image';

const positiveInt = (value) => (Number.isInteger(value) && value > 0 ? value : null);

/**
 * The image a `generate_image` result describes, or null when it describes
 * none: a refusal or provider error, a result with no path, or a payload that
 * isn't the tool's JSON. Accepts the JSON text or the parsed object.
 *
 * @param {unknown} content the result event's `content`
 * @returns {{ path: string, name: string, width: number | null, height: number | null,
 *   mimeType: string, model: string, prompt: string } | null}
 */
export function parseGeneratedImageResult(content) {
  let result = content;
  if (typeof result === 'string') {
    try { result = JSON.parse(result); } catch { return null; }
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  if (result.error) return null;
  const path = typeof result.path === 'string' ? result.path.trim() : '';
  if (!path) return null;
  const mimeType = typeof result.mime_type === 'string' ? result.mime_type : '';
  // A path to something other than an image is not this tool's picture.
  if (mimeType && !mimeType.toLowerCase().startsWith('image/')) return null;
  return {
    path,
    name: path.split(/[\\/]/).filter(Boolean).pop() || path,
    width: positiveInt(result.width),
    height: positiveInt(result.height),
    mimeType,
    model: typeof result.model === 'string' ? result.model : '',
    // Not in the tool's result today; used for the alt text when it is.
    prompt: typeof result.prompt === 'string' ? result.prompt : '',
  };
}

/**
 * `path` as a path inside the project folder, or null when it is not in it.
 *
 * Anton's workspace is the project folder, so a relative path already is one.
 * An absolute path is kept only under `projectPath`; anything else (another
 * folder, a scratchpad pod's own filesystem) can't be read through the
 * project's files route, and the card says the image can't be shown rather
 * than ask for it. A `..` segment is refused outright: the server would refuse
 * it too, and the card must never ask for a file outside the project.
 *
 * @param {string} path the path the tool returned
 * @param {string} [projectPath] the project's folder on the server's disk
 * @returns {string | null}
 */
export function projectRelativeImagePath(path, projectPath = '') {
  if (typeof path !== 'string') return null;
  let rel = path.trim().replace(/\\/g, '/');
  if (!rel) return null;
  if (rel.startsWith('/') || /^[a-zA-Z]:\//.test(rel)) {
    const root = String(projectPath || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!root || !rel.startsWith(`${root}/`)) return null;
    rel = rel.slice(root.length + 1);
  }
  const parts = rel.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (parts.length === 0 || parts.includes('..')) return null;
  return parts.join('/');
}
