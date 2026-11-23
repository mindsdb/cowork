import { useEffect, useState } from 'react';
import { useTranslation } from '../../../lib/i18n';
import { host } from '../../../platform/host';
import { fetchSharedArtifactPreview } from '../../api';
import { canPreviewOrgDraft, isImageArtifact } from '../../lib/artifactKinds';
import { canPreviewDocument } from '../../preview/kinds';
import { Modal, ModalHeader } from '../ui/Modal';
import { ArtifactViewer } from './ArtifactViewer';

export function SharedArtifactPreview({ target, onClose }) {
  const { t } = useTranslation('artifacts');
  const [card, setCard] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        if (!target.url && !target.artifact_id) throw new Error('Missing artifact');
        const result = await fetchSharedArtifactPreview(target, controller.signal);
        if (controller.signal.aborted) return;
        if (result?.draftUrl && (isImageArtifact(result) || canPreviewOrgDraft(result) || canPreviewDocument(result, host))) {
          setCard(result);
        } else {
          setError('documentPreview.reasons.unsupported');
        }
      } catch {
        if (!controller.signal.aborted) setError('workspace.openReviewFailed');
      }
    }
    void load();
    return () => controller.abort();
  }, [target]);

  if (card) return <ArtifactViewer open artifact={card} onClose={onClose} />;
  const title = t(error || 'documentPreview.loading');
  return <Modal open onClose={onClose} ariaLabel={title}>
    <ModalHeader title={title} onClose={onClose} />
  </Modal>;
}
