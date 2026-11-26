import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from '../../../lib/i18n';
import { isMobileShell } from '../../../lib/mobileShell';
import { useOrgMode } from '../../../lib/orgMode';
import { reportContent, reportArtifactContent } from '../../api';
import { ConfirmModal } from '../ConfirmModal';
import Ico from '../Icons';
import Tooltip from '../ui/Tooltip';

type TriggerProps = { 'aria-label': string; disabled?: boolean; onClick: () => void; children: ReactNode };

function TurnActionTrigger({ children, ...props }: TriggerProps) {
  return <button type="button" className="turn-action-btn" {...props}>{children}</button>;
}

// `trigger` lets a surface draw the button as its own controls are drawn;
// the default matches the action row under a chat turn.
export function ReportContentButton({ conversationId, messageId, artifactTarget, trigger: Trigger = TurnActionTrigger }: { conversationId?: string; messageId?: string; artifactTarget?: { projectId: string; artifactId: string }; trigger?: ComponentType<TriggerProps> }) {
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
  // The app stores require a way to report content; web and desktop do not offer one.
  if (!hosted || !isMobileShell || (!artifactTarget && (!conversationId || !messageId))) return null;
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
      <Trigger aria-label={t('reportContent.title')} disabled={sent} onClick={() => setOpen(true)}>{Ico.warning(16)}</Trigger>
    </Tooltip>
    {sent && <span role="status" className="s-caption">{t('reportContent.sent')}</span>}
    <ConfirmModal open={open} title={t('reportContent.title')} message={t('reportContent.message')}
      confirmLabel={t('reportContent.submit')} busy={busy} confirmDisabled={retryAt !== null}
      error={retryAt !== null ? t('reportContent.retryAt', { when: retryAt })
        : error ? t(`reportContent.${error}`) : undefined}
      onClose={() => { setOpen(false); setError(null); }} onConfirm={submit} />
  </>;
}
