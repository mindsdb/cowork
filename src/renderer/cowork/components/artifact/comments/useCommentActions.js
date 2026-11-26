// Posting a comment or a reply with its images, and reading those images back,
// for one artifact. A comment's images (Files, from a composer) are stored with
// the artifact first; the comment's text then names them (lib/commentImages).
// A failed upload posts nothing, so the draft stays where it was typed, and
// `onError` gets the reason.

import { useCallback, useRef } from 'react';
import { loadCommentImage, uploadCommentImage } from '../../../lib/artifactWorkspaceApi';
import { composeCommentText } from '../../../lib/commentImages';
import { useTranslation } from '../../../../lib/i18n';

/**
 * @param {object} artifact  anything `artifactRef` resolves (`id`, `projectId`)
 * @param {{ create: Function, reply: Function }} comments  useArtifactComments' mutations
 * @param {{ revisionId?: string | null, onError?: (message: string) => void }} [options]
 */
export function useCommentActions(artifact, comments, { revisionId = null, onError } = {}) {
  const { t } = useTranslation('artifacts');
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const textWithImages = useCallback(async (text, images) => {
    const files = Array.isArray(images) ? images.filter(Boolean) : [];
    if (!files.length) return text;
    try {
      const stored = await Promise.all(files.map(async (file) => {
        const saved = await uploadCommentImage(artifact, file);
        return { id: saved.id, name: file.name };
      }));
      return composeCommentText(text, stored);
    } catch (uploadError) {
      onErrorRef.current?.(uploadError?.message || t('imageAttachments.uploadFailed'));
      return null;
    }
  }, [artifact, t]);

  const { create: createThread, reply: replyThread } = comments;
  const create = useCallback(async ({ images, ...payload }) => {
    const text = await textWithImages(payload.text, images);
    if (text === null) return false;
    return createThread({ ...payload, text, revisionId });
  }, [textWithImages, createThread, revisionId]);

  const reply = useCallback(async (threadId, text, images) => {
    const withImages = await textWithImages(text, images);
    if (withImages === null) return false;
    return replyThread(threadId, withImages);
  }, [textWithImages, replyThread]);

  const loadImage = useCallback(
    (imageId, options) => loadCommentImage(artifact, imageId, options),
    [artifact],
  );

  return { create, reply, loadImage };
}

export default useCommentActions;
