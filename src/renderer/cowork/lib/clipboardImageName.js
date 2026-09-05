// Replace generic clipboard image names with anton/clipboard.py’s clipboard_<timestamp>_<8hex>
// shape.
// Use synchronous randomness rather than a pixel hash so immediate Send cannot outrun attachment
// creation and repeated pastes stay distinct.
// Uploads already have separate UUID directories; names do not need to be content-addressed.

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
