import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '../ui';
import { ConfirmModal } from '../ConfirmModal';
import { cn } from '../../lib/cn';
import { connectionIdentity, humanLabel } from '../../lib/connectionIdentity';
import { isDatasourceRow } from '../../lib/datasourceConnectionRows';

function ConnectionLogo({ engine, label }) {
  const [failed, setFailed] = useState(null);
  // Reuse public assets without emitting a second, hashed copy. Only safe
  // connector IDs can form a local path; missing logos fall back to an initial.
  const src = /^[a-z0-9_]+$/.test(engine) ? `logos/${engine}.svg` : null;
  return (
    <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-sm font-semibold text-ink-2">
      {src && failed !== src
        ? <img src={src} alt="" className="h-6 w-6 object-contain dark:brightness-0 dark:invert" onError={() => setFailed(src)} />
        : label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function ConnectionCard({ connection, onDelete, onModify }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const engine = connection.engine || 'unknown';
  const name = connection.name || connection.slug || 'unnamed';
  const { title, subtitle } = connectionIdentity(connection);
  const needsReconnect = connection.status === 'needs_reconnect';
  // The summary API omits status for healthy saved connections. Do not paint
  // an unfamiliar explicit status green as if we had checked it successfully
  // — a blank-but-present status ('') is unfamiliar too, not "no status".
  const connected = connection.status == null || connection.status === 'connected';
  const statusLabel = needsReconnect ? 'Reconnect needed'
    : connected ? 'Connected' : humanLabel(connection.status);

  const handleRemove = async () => {
    setBusy(true);
    setError('');
    try {
      await onDelete?.(connection);
      setConfirming(false);
    } catch (e) {
      // Shown in the dialog rather than swallowed: a disconnect that failed
      // silently leaves the card on screen and reads as a no-op.
      setError(e?.message || 'That connection could not be disconnected.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <article className={cn(
        'relative flex min-h-[120px] flex-col gap-2.5 rounded-[10px] px-4 py-3.5',
        '[transition:background_.15s_ease,border-color_.15s_ease]',
        needsReconnect
          ? 'border border-solid border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,var(--surface))]'
          : 'border border-solid border-line bg-surface hover:border-line-2 hover:bg-surface-2',
      )}>
        {typeof onModify === 'function' && (
          <button
            type="button"
            aria-label={`${needsReconnect ? 'Reconnect' : 'Manage'} ${title}: ${subtitle}`}
            title={`${title} — ${subtitle}`}
            disabled={busy}
            onClick={() => onModify(connection)}
            className="absolute inset-0 z-10 cursor-pointer rounded-[inherit] border-0 bg-transparent outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait"
          />
        )}
        <div className="flex min-w-0 items-center gap-2.5">
          <ConnectionLogo engine={engine} label={title} />
          <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-display)] text-[16px] font-semibold tracking-normal text-ink">
            {title}
          </span>
        </div>
        <span className="truncate text-sm text-ink-3">{subtitle}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2.5 border-x-0 border-b-0 border-t border-solid border-line pt-2.5">
          <span className={cn('flex min-w-0 flex-1 items-center gap-2 text-xs', needsReconnect ? 'text-warning' : 'text-ink-3')}>
            {needsReconnect
              ? <TriangleAlert size={12} className="shrink-0" aria-hidden="true" />
              : <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', connected ? 'bg-[var(--success)]' : 'bg-ink-4')} />}
            <span className="truncate">{statusLabel}</span>
          </span>
          {/* z-20: must stay above the overlay button's z-10, or the whole-card
              click target swallows this click and Disconnect becomes unreachable. */}
          <Button
            variant="subtle"
            size="sm"
            className="relative z-20"
            onClick={() => { setError(''); setConfirming(true); }}
            disabled={busy}
          >
            {busy ? 'Removing…' : 'Disconnect'}
          </Button>
        </div>
      </article>
      <ConfirmModal
        open={confirming}
        title={`Disconnect ${title}?`}
        message={isDatasourceRow(connection)
          ? `${subtitle} will be removed and its stored credentials deleted. Conversations that use it lose access.`
          : `${subtitle} will be disconnected. You can connect it again later.`}
        confirmLabel="Disconnect"
        busyLabel="Disconnecting…"
        destructive
        busy={busy}
        error={error}
        onConfirm={handleRemove}
        onClose={() => { setConfirming(false); setError(''); }}
      />
    </>
  );
}
