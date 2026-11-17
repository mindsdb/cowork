// The artifact a chat message was about, as a pill under the message
// (ENG-4227). A message sent from the artifact viewer's chat bar ends in
// "(About the artifact `<slug>`.)" so the agent knows which artifact is meant;
// the transcript shows that suffix as this pill instead: the artifact's title
// and type icon, looked up by slug in the artifacts store, or the slug while
// no card is known (or the title the caller already has). Clicking opens the artifact's preview.

import { useArtifactCardBySlug } from '../../lib/artifactsStore';
import { ArtifactIcon, displayTitle } from './ArtifactIcon';
import { useTranslation } from '../../../lib/i18n';

export function ArtifactRefPill({ slug, onOpen, fallbackTitle = '' }) {
  const { t } = useTranslation('artifacts');
  const card = useArtifactCardBySlug(slug);
  const title = card ? displayTitle(card) : (fallbackTitle || slug);
  const canOpen = !!card && !!onOpen;
  const body = (
    <>
      <span className="artifact-ref-pill-icon">
        <ArtifactIcon artifact={card || { slug, type: 'html-app' }} size={14} />
      </span>
      <span className="artifact-ref-pill-title">{title}</span>
    </>
  );
  if (!canOpen) {
    return <span className="artifact-ref-pill" title={slug}>{body}</span>;
  }
  return (
    <button
      type="button"
      className="artifact-ref-pill"
      title={slug}
      aria-label={t('refPill.open', { title })}
      onClick={() => onOpen(card)}
    >
      {body}
    </button>
  );
}

export default ArtifactRefPill;
