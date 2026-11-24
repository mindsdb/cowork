import { Alert } from '../../ui';
import { useTranslation } from '../../../../lib/i18n';

// The connections a full-stack publish would upload credentials for, shown
// above the button that approves them.
export function DatasourceApprovalNotice({ pending, className = '' }) {
  const { t } = useTranslation('artifacts');
  if (!pending?.length) return null;
  const list = pending.map((d) => d.label || `${d.engine}/${d.name}`).join(', ');
  return (
    <Alert variant="warning" className={className}>
      {t('publish.datasources.notice', { list })}
    </Alert>
  );
}

export default DatasourceApprovalNotice;
