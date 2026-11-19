import { useEffect, useMemo, useState } from 'react';

import Ico from '../components/Icons';
import { ConfirmModal } from '../components/ConfirmModal';
import Button from '../components/ui/Button';
import { Textarea } from '../components/ui/Input';
import Select from '../components/ui/Select';
import type { DeliveryRecord, SourceContext } from './api';
import { sourceContextLabel, sourceProviderLabel } from './developerTools';
import { SafeCodeExternalLink } from './SafeCodeExternalLink';
import { useTranslation } from '../../lib/i18n';

type UpdateAction = 'progress' | 'result';

function deliveryTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ''
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function latestDeliveryFor(context: SourceContext, deliveries: DeliveryRecord[]): DeliveryRecord | null {
  return deliveries
    .filter((item) => item.target_url === context.url && item.action !== 'draft_pull_request')
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] || null;
}

export function SourceUpdateSection({
  contexts,
  deliveries,
  suggestedUpdate,
  busy,
  onPublish,
  onComplete,
}: {
  contexts: SourceContext[];
  deliveries: DeliveryRecord[];
  suggestedUpdate: string;
  busy: boolean;
  onPublish: (target: SourceContext, text: string, action: UpdateAction) => Promise<void>;
  onComplete: (target: SourceContext) => Promise<void>;
}) {
  const { t } = useTranslation('code');
  const [activeUrl, setActiveUrl] = useState('');
  const [text, setText] = useState('');
  const [action, setAction] = useState<UpdateAction>('result');
  const [completionContext, setCompletionContext] = useState<SourceContext | null>(null);
  const contextKey = contexts.map((context) => context.url).join('|');
  const activeContext = useMemo(
    () => contexts.find((context) => context.url === activeUrl) || null,
    [activeUrl, contexts],
  );

  useEffect(() => {
    setActiveUrl('');
    setText('');
    setAction('result');
    setCompletionContext(null);
  }, [contextKey]);

  if (!contexts.length) return null;

  const openComposer = (context: SourceContext) => {
    setActiveUrl(context.url);
    setText('');
    setAction('result');
  };

  return (
    <section className="code-source-updates" aria-label={t('sourceUpdate.ariaLabel')}>
      <header><strong>{t('sourceUpdate.title')}</strong></header>
      <div className="code-source-update-list">
        {contexts.map((context) => {
          const delivery = latestDeliveryFor(context, deliveries);
          const finalPosted = deliveries.some((item) => item.target_url === context.url && item.action === 'result' && item.status === 'published');
          const completed = deliveries.some((item) => item.target_url === context.url && item.action === 'complete_source' && item.status === 'published');
          const canComplete = context.kind === 'issue' && (context.provider === 'github' || context.provider === 'linear') && finalPosted && !completed;
          const isActive = context.url === activeUrl;
          return (
            <article className="code-source-update" key={`${context.provider}:${context.url}`}>
              <div className="code-source-update__summary">
                <SafeCodeExternalLink className="code-source-update__link" value={context.url}>
                  <span className="section-label">{sourceProviderLabel(context.provider)}</span>
                  <strong>{sourceContextLabel(context)} · {context.title}</strong>
                  {Ico.externalLink(12)}
                </SafeCodeExternalLink>
                <div className="code-source-update__actions">
                  {canComplete && <Button size="sm" variant="subtle" disabled={busy} onClick={() => setCompletionContext(context)}>{t('sourceUpdate.completeIssue')}</Button>}
                  <Button size="sm" variant="subtle" disabled={busy} onClick={() => isActive ? setActiveUrl('') : openComposer(context)}>
                    {isActive ? t('sourceUpdate.cancel') : delivery?.status === 'published' ? t('sourceUpdate.postAnother') : t('sourceUpdate.postUpdate')}
                  </Button>
                </div>
              </div>
              {delivery && (
                <SafeCodeExternalLink
                  className={`code-source-update__receipt is-${delivery.status}`}
                  value={delivery.external_url}
                >
                  <span><i aria-hidden="true" /> {delivery.status !== 'published' ? t('sourceUpdate.needsAttention') : delivery.action === 'complete_source' ? t('sourceUpdate.completed') : t('sourceUpdate.posted')}</span>
                  <small>{deliveryTime(delivery.created_at)}{delivery.detail ? ` · ${delivery.detail}` : ''}</small>
                </SafeCodeExternalLink>
              )}
              {isActive && activeContext && (
                <div className="code-source-update__composer">
                  <Textarea
                    value={text}
                    onChange={setText}
                    placeholder={t('sourceUpdate.placeholder', { target: sourceContextLabel(activeContext) })}
                    rows={4}
                    autoFocus
                    disabled={busy}
                  />
                  <footer>
                    <Select
                      value={action}
                      onValueChange={(value) => { if (value === 'progress' || value === 'result') setAction(value); }}
                      options={[{ value: 'progress', label: t('sourceUpdate.progress') }, { value: 'result', label: t('sourceUpdate.finalResult') }]}
                      size="sm"
                      ariaLabel={t('sourceUpdate.typeAriaLabel')}
                      minWidth={104}
                    />
                    <div>
                      {suggestedUpdate && !text && <Button size="sm" variant="subtle" onClick={() => setText(suggestedUpdate)}>{t('sourceUpdate.useLatestSummary')}</Button>}
                      <Button size="sm" variant="primary" disabled={busy || !text.trim()} onClick={async () => {
                        await onPublish(activeContext, text.trim(), action);
                        setText('');
                        setActiveUrl('');
                      }}>{t('sourceUpdate.postTo', { provider: sourceProviderLabel(activeContext.provider) })}</Button>
                    </div>
                  </footer>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <ConfirmModal
        open={completionContext !== null}
        title={t('sourceUpdate.completeConfirm.title', { target: completionContext ? sourceContextLabel(completionContext) : t('sourceUpdate.completeConfirm.issue') })}
        message={completionContext?.provider === 'linear'
          ? t('sourceUpdate.completeConfirm.linearMessage')
          : t('sourceUpdate.completeConfirm.githubMessage')}
        confirmLabel={t('sourceUpdate.completeConfirm.confirm')}
        busy={busy}
        onClose={() => { if (!busy) setCompletionContext(null); }}
        onConfirm={async () => {
          if (!completionContext) return;
          await onComplete(completionContext);
          setCompletionContext(null);
        }}
      />
    </section>
  );
}
