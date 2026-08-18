// Browsers hand a clipboard-pasted screenshot a generic filename — "image.png"
// in Chrome/Firefox/Safari, "image.bmp" on Windows, "image.tiff" on macOS — so
// every paste in a conversation arrives under the same name and neither the user
// (in the composer chips) nor the agent (in the attachment list it gets each
// turn) can tell them apart. ENG-1100. Rename those to the shape anton's CLI
// already uses for clipboard saves (anton/clipboard.py): clipboard_<ts>_<8hex>.
//
// The suffix is RANDOM here, where the CLI hashes the pixels. Deliberate, for
// two reasons: crypto.getRandomValues is synchronous, so the paste handler stays
// sync and a user who hits Enter right after Ctrl+V cannot outrun the chip; and
// the same image pasted twice within one second gets two names instead of
// colliding on one. Content-addressed names buy nothing on this side — the
// server stores every upload in its own uuid directory, so nothing is ever
// overwritten (cowork-server/cowork/services/files.py).

// A bare `image.<ext>` is the browser's placeholder. Deliberately loose about
// which extension: image.bmp/tiff/avif are all real, and a hardcoded list would
// silently miss the next one. The `image/*` mime check below carries the weight,
// and no filename a human would choose looks like this.
const GENERIC_IMAGE_NAME = /^image\.[a-z0-9]{2,5}$/i;

const MIME_EXTENSION = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
  'image/tiff': '.tiff',
};

export function isGenericImageName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return true;
  return GENERIC_IMAGE_NAME.test(trimmed);
}

function extensionFor(file) {
  const fromMime = MIME_EXTENSION[String(file.type || '').toLowerCase()];
  if (fromMime) return fromMime;
  const name = String(file.name || '');
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

function randomSuffix() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function clipboardImageName(file) {
  const ts = Math.floor(Date.now() / 1000);
  return `clipboard_${ts}_${randomSuffix()}${extensionFor(file)}`;
}

/** File[] → File[]: generic image names replaced, everything else passed through. */
export function renameClipboardImages(files) {
  return Array.from(files || []).map((file) => {
    if (!String(file.type || '').startsWith('image/')) return file;
    if (!isGenericImageName(file.name)) return file;
    return new File([file], clipboardImageName(file), {
      type: file.type,
      lastModified: file.lastModified,
    });
  });
}
