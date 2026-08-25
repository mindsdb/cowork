import { useEffect, useMemo, useState } from 'react';

import { host } from '../../platform/host';
import Ico from '../components/Icons';
import { ConfirmModal } from '../components/ConfirmModal';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import type { DeliveryRecord, SourceContext } from './api';
import { sourceContextLabel, sourceProviderLabel } from './developerTools';

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
    <section className="code-source-updates" aria-label="Linked work updates">
      <header><strong>Linked work</strong><span>Post only when you choose</span></header>
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
                <button type="button" className="code-source-update__link" onClick={() => void host.openExternal(context.url)}>
                  <span>{sourceProviderLabel(context.provider)}</span>
                  <strong>{sourceContextLabel(context)} · {context.title}</strong>
                  {Ico.externalLink(11)}
                </button>
                <div className="code-source-update__actions">
                  {canComplete && <Button size="sm" variant="subtle" disabled={busy} onClick={() => setCompletionContext(context)}>Complete issue</Button>}
                  <Button size="sm" variant="subtle" disabled={busy} onClick={() => isActive ? setActiveUrl('') : openComposer(context)}>
                    {isActive ? 'Cancel' : delivery?.status === 'published' ? 'Post another' : 'Post update'}
                  </Button>
                </div>
              </div>
              {delivery && (
                <button
                  type="button"
                  className={`code-source-update__receipt is-${delivery.status}`}
                  onClick={() => { if (delivery.external_url) void host.openExternal(delivery.external_url); }}
                  disabled={!delivery.external_url}
                >
                  <span><i aria-hidden="true" /> {delivery.status !== 'published' ? 'Needs attention' : delivery.action === 'complete_source' ? 'Completed' : 'Posted'}</span>
                  <small>{deliveryTime(delivery.created_at)}{delivery.detail ? ` · ${delivery.detail}` : ''}</small>
                </button>
              )}
              {isActive && activeContext && (
                <div className="code-source-update__composer">
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder={`Write an update for ${sourceContextLabel(activeContext)}…`}
                    rows={4}
                    autoFocus
                    disabled={busy}
                  />
                  <footer>
                    <Select
                      value={action}
                      onValueChange={(value) => { if (value === 'progress' || value === 'result') setAction(value); }}
                      options={[{ value: 'progress', label: 'Progress' }, { value: 'result', label: 'Final result' }]}
                      size="sm"
                      ariaLabel="Update type"
                      minWidth={104}
                    />
                    <div>
                      {suggestedUpdate && !text && <Button size="sm" variant="subtle" onClick={() => setText(suggestedUpdate)}>Use latest summary</Button>}
                      <Button size="sm" variant="primary" disabled={busy || !text.trim()} onClick={async () => {
                        await onPublish(activeContext, text.trim(), action);
                        setText('');
                        setActiveUrl('');
                      }}>Post to {sourceProviderLabel(activeContext.provider)}</Button>
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
        title={`Complete ${completionContext ? sourceContextLabel(completionContext) : 'issue'}?`}
        message={completionContext?.provider === 'linear'
          ? 'Move this Linear issue to the team’s completed state.'
          : 'Close this GitHub issue. Its discussion and history remain available.'}
        confirmLabel="Complete issue"
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
