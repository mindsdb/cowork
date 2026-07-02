// Inline image thumbnail for chat attachments — shared by the composer's
// pending-attachment strip and by sent user-turn bubbles. Without it,
// image attachments render as a generic icon+name chip and never show
// the picture.
//
// The renderer CSP is `img-src 'self' data: blob:`, so a direct loopback
// <img src="http://127.0.0.1/…"> is blocked. For a server attachment we
// fetch the bytes (connect-src allows the loopback origin) and render a
// blob: URL — the same approach ContextFileModal uses for inline image
// previews. A local File (composer, not yet uploaded) skips the fetch and
// goes straight to createObjectURL.
//
// Pass exactly one source: `file` (a File/Blob) or `url` (an absolute
// attachment raw URL). The object URL is revoked on unmount / source
// change so blobs don't leak across re-renders.

import { useEffect, useRef, useState } from 'react';
import Ico from './Icons';

export function AttachmentThumbnail({
  file = null,
  url = null,
  alt = '',
  onOpen = null,
  // `cover`: fixed square tile, image cropped to fill (composer chip).
  // Otherwise: natural aspect bounded by maxW/maxH (chat bubble).
  cover = false,
  size = 30,
  maxW = 240,
  maxH = 200,
}) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  // Hold the object URL we created so cleanup revokes the right one even
  // if the source changes before an in-flight fetch resolves.
  const createdRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    setSrc('');
    setFailed(false);

    const revoke = () => {
      if (createdRef.current) {
        URL.revokeObjectURL(createdRef.current);
        createdRef.current = '';
      }
    };
    const adopt = (blob) => {
      if (cancelled) return;
      const objectUrl = URL.createObjectURL(blob);
      createdRef.current = objectUrl;
      setSrc(objectUrl);
    };

    if (file) {
      try { adopt(file); } catch { setFailed(true); }
    } else if (url) {
      fetch(url)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
        .then(adopt)
        .catch(() => { if (!cancelled) setFailed(true); });
    } else {
      setFailed(true);
    }

    return () => { cancelled = true; revoke(); };
  }, [file, url]);

  const frameStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: cover ? 6 : 12,
    overflow: 'hidden',
    border: '1px solid var(--line, rgba(0,0,0,0.1))',
    background: 'var(--surface-2, rgba(0,0,0,0.04))',
    color: 'var(--ink-3, #8a8f98)',
    ...(cover ? { width: size, height: size, flex: '0 0 auto' } : {}),
  };

  let inner;
  if (failed) {
    inner = <span style={{ display: 'inline-flex', padding: cover ? 0 : 14 }}>{Ico.image(cover ? 16 : 22)}</span>;
  } else if (src) {
    inner = (
      <img
        src={src}
        alt={alt}
        style={cover
          ? { width: size, height: size, objectFit: 'cover', display: 'block' }
          : { maxWidth: maxW, maxHeight: maxH, width: 'auto', height: 'auto', display: 'block' }}
      />
    );
  } else {
    // Loading placeholder — reserve space so the bubble doesn't jump.
    inner = <span style={{ display: 'inline-block', width: cover ? size : 120, height: cover ? size : 80 }} />;
  }

  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title={alt || 'Open image'}
        aria-label={alt ? `Open image: ${alt}` : 'Open image'}
        style={{ ...frameStyle, padding: 0, cursor: 'pointer' }}
      >
        {inner}
      </button>
    );
  }
  return <span style={frameStyle} aria-label={alt || undefined}>{inner}</span>;
}
