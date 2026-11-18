import { useState } from 'react';
import { useTranslation } from '../../../lib/i18n';
import { useOrgMode } from '../../../lib/orgMode';
import { reportContent, reportArtifactContent } from '../../api';
import { ConfirmModal } from '../ConfirmModal';
import Ico from '../Icons';
import Tooltip from '../ui/Tooltip';

export function ReportContentButton({ conversationId, messageId, artifactTarget }: { conversationId?: string; messageId?: string; artifactTarget?: { projectId: string; artifactId: string } }) {
  const { t } = useTranslation('chat');
  const hosted = useOrgMode();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!hosted || (!artifactTarget && (!conversationId || !messageId))) return null;
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (artifactTarget) await reportArtifactContent(artifactTarget.projectId, artifactTarget.artifactId);
      else if (conversationId && messageId) await reportContent(conversationId, messageId);
      setSent(true);
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return <>
    <Tooltip content={t('reportContent.title')}>
      <button type="button" className="turn-action-btn" aria-label={t('reportContent.title')}
        disabled={sent} onClick={() => setOpen(true)}>{Ico.warning(16)}</button>
    </Tooltip>
    {sent && <span role="status" className="s-caption">{t('reportContent.sent')}</span>}
    <ConfirmModal open={open} title={t('reportContent.title')} message={t('reportContent.message')}
      confirmLabel={t('reportContent.submit')} busy={busy} error={failed ? t('reportContent.failed') : undefined}
      onClose={() => { setOpen(false); setFailed(false); }} onConfirm={submit} />
  </>;
}
