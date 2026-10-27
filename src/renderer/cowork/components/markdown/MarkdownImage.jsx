// An image in a document whose own folder the host serves (the artifact
// viewer). `loadImage` fetches the file and this shows it from a blob: URL,
// since the desktop shell's CSP refuses an image from the API server and an
// org deployment's drafts route needs a bearer an <img> can't send. A remote
// http(s) image renders as written, and the shell's CSP decides it. A path
// the loader refuses, or a file it can't load, shows the alt text in the
// image's place instead of a broken-image icon.
//
// The blob: URL is made here rather than through AttachmentThumbnail's
// useBlobImageSrc: that module brings in the authenticated API client, which
// every Markdown consumer would then load, chat included.

import { useEffect, useState } from 'react';

const REMOTE_IMAGE_RE = /^https?:\/\//i;

export function MarkdownImage({ src = '', alt = '', title, loadImage }) {
  const remote = REMOTE_IMAGE_RE.test(src);
  const [blob, setBlob] = useState(null);
  const [failed, setFailed] = useState(false);
  const [objectUrl, setObjectUrl] = useState('');

  useEffect(() => {
    setBlob(null);
    setFailed(false);
    if (remote) return undefined;
    const request = loadImage(src);
    if (!request) {
      setFailed(true);
      return undefined;
    }
    let cancelled = false;
    request.then(
      (loaded) => { if (!cancelled) setBlob(loaded); },
      () => { if (!cancelled) setFailed(true); },
    );
    return () => { cancelled = true; };
  }, [src, remote, loadImage]);

  // The blob: URL lives as long as this image shows that Blob.
  useEffect(() => {
    if (!blob) {
      setObjectUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  if (remote) return <img src={src} alt={alt} title={title} />;
  if (failed) {
    return alt ? (
      <span role="img" aria-label={alt} title={title} className="italic text-ink-3">{alt}</span>
    ) : null;
  }
  return objectUrl ? <img src={objectUrl} alt={alt} title={title} /> : null;
}
