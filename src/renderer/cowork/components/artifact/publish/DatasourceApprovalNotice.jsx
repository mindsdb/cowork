import { Alert } from '../../ui';
import { useTranslation } from '../../../../lib/i18n';
import { datasourceList } from './publishErrors';

// The connections a full-stack publish would upload credentials for, shown
// above the button that approves them.
export function DatasourceApprovalNotice({ pending, className = '' }) {
  const { t } = useTranslation('artifacts');
  if (!pending?.length) return null;
  return (
    <Alert variant="warning" className={className}>
      {t('publish.datasources.notice', { list: datasourceList(pending) })}
    </Alert>
  );
}

export default DatasourceApprovalNotice;
