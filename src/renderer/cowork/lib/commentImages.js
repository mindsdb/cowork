// Images in artifact comments (ENG-4410).
//
// The comments service keeps a comment's text and nothing else, so an image is
// uploaded to the artifact (POST .../comment-images, cowork-server
// services/comment_images.py) and the comment names it with one marker line
// per image, after the words:
//
//   Looks off here
//
//   ![clipboard_1763_ab12cd34.png](cowork-image:<32 hex>.png)
//
// The app reads the markers back out: the words show as the comment, the
// images as thumbnails. A viewer that knows nothing of them (the published
// page) shows the marker line, which still says an image was attached.

const MARKER = /!\[([^\]\n]*)\]\(cowork-image:([0-9a-f]{32}\.(?:png|jpg|gif|webp))\)/g;
const IMAGE_ID = /^[0-9a-f]{32}\.(?:png|jpg|gif|webp)$/;
const MAX_NAME = 80;

export function isCommentImageId(id) {
  return typeof id === 'string' && IMAGE_ID.test(id);
}

/** `text` → `{ body, images: [{ id, name }] }`, the markers taken out. */
export function parseCommentText(text) {
  const raw = typeof text === 'string' ? text : '';
  const images = [];
  const body = raw.replace(MARKER, (_match, name, id) => {
    if (!images.some((image) => image.id === id)) images.push({ id, name });
    return '';
  });
  return { body: images.length ? body.replace(/\n{3,}/g, '\n\n').trim() : raw, images };
}

// A name can't close the marker early or span lines.
function markerName(name) {
  return String(name || 'image').replace(/[[\]()\n\r]/g, ' ').trim().slice(0, MAX_NAME) || 'image';
}

/** The comment text for `body` and its `images` ([{ id, name }]). */
export function composeCommentText(body, images = []) {
  const words = String(body || '').trim();
  const markers = (images || [])
    .filter((image) => isCommentImageId(image?.id))
    .map((image) => `![${markerName(image.name)}](cowork-image:${image.id})`);
  if (!markers.length) return words;
  return [words, markers.join('\n')].filter(Boolean).join('\n\n');
}

/** Every image a thread names, root first then replies, once each. */
export function threadImages(thread) {
  const texts = [thread?.payload?.text, ...((thread?.payload?.replies || []).map((r) => r?.text))];
  const out = [];
  for (const text of texts) {
    for (const image of parseCommentText(text).images) {
      if (!out.some((seen) => seen.id === image.id)) out.push(image);
    }
  }
  return out;
}

/**
 * A thread's images as Files, to attach to the chat message that asks the
 * agent to address it. An image that can't be read is left out: the prompt
 * still names it, and the fix goes ahead on the words.
 *
 * @param {(id: string) => Promise<Blob>} load  e.g. loadCommentImage bound to the artifact
 */
export async function threadImageFiles(thread, load) {
  const files = await Promise.all(threadImages(thread).map(async (image) => {
    try {
      const blob = await load(image.id);
      return new File([blob], image.name || image.id, { type: blob.type || 'image/png' });
    } catch {
      return null;
    }
  }));
  return files.filter(Boolean);
}
