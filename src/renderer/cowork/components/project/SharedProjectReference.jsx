import { useTranslation } from '../../../lib/i18n';

/** Distinguish received projects without revealing their owners' identities. */
export default function SharedProjectReference({ project }) {
  const { t } = useTranslation('projects');
  if (!project?.shared || !project.id) return null;
  return (
    <span title={t('sharedProjectReference.title', { id: project.id })} className="text-xs font-mono text-ink-3">
      {t('sharedProjectReference.label', { id: project.id.slice(-8) })}
    </span>
  );
}
