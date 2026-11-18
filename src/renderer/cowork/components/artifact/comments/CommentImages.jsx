// A comment's images as thumbnails (ENG-4410). The image is read with the
// viewer's credential (`loadImage`, artifactWorkspaceApi loadCommentImage) and
// shown from a local object URL, released when the thumbnail goes. Clicking
// one shows it full width; clicking again shrinks it back.

import { useEffect, useState } from 'react';
import { useTranslation } from '../../../../lib/i18n';

function CommentImage({ image, loadImage }) {
  const { t } = useTranslation('artifacts');
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  const [large, setLarge] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let url = '';
    loadImage(image.id, { signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [image.id, loadImage]);

  if (failed) return <span className="artifact-comment-image-missing">{t('imageAttachments.unavailable')}</span>;
  if (!src) return <span className="artifact-comment-image-placeholder" aria-hidden="true" />;
  return (
    <button
      type="button"
      className={`artifact-comment-image${large ? ' is-large' : ''}`}
      aria-label={large ? t('imageAttachments.shrink') : t('imageAttachments.enlarge')}
      aria-pressed={large}
      onClick={(event) => { event.stopPropagation(); setLarge((v) => !v); }}
    >
      <img src={src} alt={image.name || t('imageAttachments.image')} />
    </button>
  );
}

/** Thumbnails for `images` ([{ id, name }]); nothing when there are none. */
export function CommentImages({ images, loadImage }) {
  if (!images?.length || !loadImage) return null;
  return (
    <div className="artifact-comment-images">
      {images.map((image) => <CommentImage key={image.id} image={image} loadImage={loadImage} />)}
    </div>
  );
}

export default CommentImages;
