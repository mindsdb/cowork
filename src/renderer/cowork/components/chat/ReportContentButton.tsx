import { useEffect, useState } from 'react';
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
  const [error, setError] = useState<'failed' | 'rateLimited' | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  useEffect(() => {
    if (retryAt === null) return;
    const timer = window.setTimeout(() => {
      setRetryAt(null);
      setError(null);
    }, Math.max(0, retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [retryAt]);
  if (!hosted || (!artifactTarget && (!conversationId || !messageId))) return null;
  const submit = async () => {
    if (busy || retryAt !== null) return;
    setBusy(true);
    setError(null);
    try {
      if (artifactTarget) await reportArtifactContent(artifactTarget.projectId, artifactTarget.artifactId);
      else if (conversationId && messageId) await reportContent(conversationId, messageId);
      setSent(true);
      setOpen(false);
    } catch (cause) {
      const refusal = cause as { status?: number; retry_at?: string } | null;
      if (refusal?.status === 429) {
        const until = Date.parse(refusal.retry_at ?? '');
        setRetryAt(until > Date.now() ? until : null);
        setError('rateLimited');
      } else {
        setError('failed');
      }
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
      confirmLabel={t('reportContent.submit')} busy={busy} confirmDisabled={retryAt !== null}
      error={retryAt !== null ? t('reportContent.retryAt', { when: retryAt })
        : error ? t(`reportContent.${error}`) : undefined}
      onClose={() => { setOpen(false); setError(null); }} onConfirm={submit} />
  </>;
}
