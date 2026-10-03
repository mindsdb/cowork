// One saved connection as a collection row: logo, provider, account, status,
// and a labelled Disconnect that stays visible (it is the only action besides
// opening, and it confirms first). The row is an <article>; opening is the
// title button stretched over it, so Disconnect sits beside it, not inside it.

import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '../ui';
import { HoverActions, ListItem, StatusDot } from '../collection';
import { connectionIdentity, humanLabel } from '../../lib/connectionIdentity';

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
    if (!window.confirm(`Disconnect ${engine}/${name}?`)) return;
    setBusy(true);
    try {
      await onDelete?.(connection);
    } finally {
      setBusy(false);
    }
  };

  const canOpen = typeof onModify === 'function';
  return (
    <ListItem
      as="article"
      leading={<ConnectionLogo engine={engine} label={title} />}
      title={title}
      description={subtitle}
      onActivate={canOpen ? () => onModify(connection) : undefined}
      activateLabel={canOpen ? `${needsReconnect ? 'Reconnect' : 'Manage'} ${title}: ${subtitle}` : undefined}
      busy={busy}
      className={needsReconnect ? 'bg-[color-mix(in_srgb,var(--warning)_8%,var(--surface))]' : undefined}
      meta={(
        <>
          {needsReconnect ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-warning">
              <TriangleAlert size={12} className="shrink-0" aria-hidden="true" />
              {statusLabel}
            </span>
          ) : (
            <StatusDot tone={connected ? 'success' : 'muted'}>{statusLabel}</StatusDot>
          )}
          <HoverActions reveal>
            <Button variant="subtle" size="sm" onClick={handleRemove} disabled={busy}>
              {busy ? 'Removing…' : 'Disconnect'}
            </Button>
          </HoverActions>
        </>
      )}
    />
  );
}
