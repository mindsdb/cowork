// Pass exactly one source: file (File/Blob) or url (absolute raw attachment URL).
// CSP blocks loopback img sources; fetch server bytes and display a revoked-on-cleanup blob URL.

import { useEffect, useRef, useState } from 'react';
import Ico from './Icons';
import { Tooltip } from './ui';
import { fetchAuthenticatedBlob } from '../lib/authenticatedResource';

// Blob-fetch workaround for the loopback image CSP restriction. Pass exactly one File/Blob or URL.
// Returns { src, failed }; src is empty while loading.
export function useBlobImageSrc({ file = null, url = null } = {}) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
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
      fetchAuthenticatedBlob(url)
        .then(adopt)
        .catch(() => { if (!cancelled) setFailed(true); });
    } else {
      setFailed(true);
    }

    return () => { cancelled = true; revoke(); };
  }, [file, url]);

  return { src, failed };
}

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
  const { src, failed } = useBlobImageSrc({ file, url });

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
      <Tooltip content={alt || 'Open image'}>
        <button
          type="button"
          onClick={onOpen}
          aria-label={alt ? `Open image: ${alt}` : 'Open image'}
          style={{ ...frameStyle, padding: 0, cursor: 'pointer' }}
        >
          {inner}
        </button>
      </Tooltip>
    );
  }
  return <span style={frameStyle} aria-label={alt || undefined}>{inner}</span>;
}
