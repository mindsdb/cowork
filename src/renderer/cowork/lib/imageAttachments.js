// Images pasted or dropped into the artifact viewer's chat bar and comment
// composers (ENG-4410). The same paste and drop handling as the main
// composer (useFileDrop, extractClipboardFiles, renameClipboardImages); what
// these fields take is narrower, because the image goes straight to a model
// (quick edit) or is shown to other people (comments): PNG, JPEG, GIF or
// WebP, up to 5 MB each, a few per message. cowork-server checks the same
// bounds by the bytes (services/comment_images.py).

import { useCallback, useEffect, useRef, useState } from 'react';
import { extractClipboardFiles, useFileDrop } from './useFileDrop';
import { renameClipboardImages } from './clipboardImageName';
import i18n from '../../lib/i18n';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 4;

const tr = (key, vars) => i18n.t(`imageAttachments.${key}`, { ns: 'artifacts', ...vars });

let nextId = 0;

/** A pasted File as the main composer's pending attachment (AttachmentChip). */
export function imageAttachment(file) {
  nextId += 1;
  return {
    id: `image-${Date.now()}-${nextId}`,
    source: 'file',
    pendingFile: file,
    name: file.name,
    mime: file.type || undefined,
    size: file.size,
  };
}

/**
 * Which of `files` may join `count` images already attached:
 * `{ accepted: File[], error: string }`, `error` naming the first refusal.
 */
export function acceptImages(files, count = 0, max = MAX_IMAGES) {
  const accepted = [];
  let error = '';
  for (const file of Array.from(files || [])) {
    if (!IMAGE_TYPES.includes(String(file?.type || '').toLowerCase())) {
      error = error || tr('onlyImages');
    } else if (file.size > MAX_IMAGE_BYTES) {
      error = error || tr('tooLarge', { name: file.name });
    } else if (count + accepted.length >= max) {
      error = error || tr('tooMany', { count: max });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, error };
}

/** A File's bytes as base64, for a JSON body. */
export async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Pending images for one composer: paste (`onPaste` on the textarea), drop
 * (`dropHandlers` on its frame) and the strip's remove. A plain-text paste
 * falls through to the textarea. `error` says why a file was left out, and
 * clears on the next change.
 */
export function useImageAttachments({ disabled = false, max = MAX_IMAGES } = {}) {
  const [images, setImages] = useState([]);
  const [error, setError] = useState('');
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const add = useCallback((files) => {
    const { accepted, error: refusal } = acceptImages(files, imagesRef.current.length, max);
    setError(refusal);
    if (!accepted.length) return;
    const added = renameClipboardImages(accepted).map(imageAttachment);
    imagesRef.current = [...imagesRef.current, ...added];
    setImages(imagesRef.current);
  }, [max]);

  const remove = useCallback((id) => {
    setError('');
    setImages((prev) => prev.filter((image) => image.id !== id));
  }, []);

  const clear = useCallback(() => {
    setError('');
    setImages((prev) => (prev.length ? [] : prev));
  }, []);

  // Read the clipboard while the event is live, and keep the handler sync, as
  // the main composer does: Enter right after a paste must see the image.
  const onPaste = useCallback((event) => {
    if (disabled) return;
    const files = extractClipboardFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    add(files);
  }, [add, disabled]);

  const { isDragging, dropHandlers } = useFileDrop({ onFiles: add, disabled });

  // A refusal note is a moment's information, not a state to keep.
  useEffect(() => {
    if (!error) return undefined;
    const timer = setTimeout(() => setError(''), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  return { images, error, add, remove, clear, onPaste, isDragging, dropHandlers };
}
