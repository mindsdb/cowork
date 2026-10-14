// `<ConnectionCard>` / `<ConnectionRow>` — one connected app as a grid card or
// a list row, built from one set of collection-kit slots, so the view toggle
// changes layout, not content.

import { useState } from 'react';
import { Button } from '../ui';
import { ConfirmModal } from '../ConfirmModal';
import { ItemActions, ItemCard, ListItem, StatusDot } from '../collection';
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

function useConnectionSlots({ connection, onDelete, onModify }) {
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

  return {
    leading: <ConnectionLogo engine={engine} label={title} />,
    title,
    description: subtitle,
    onActivate: typeof onModify === 'function' ? () => onModify(connection) : undefined,
    activateLabel: `${needsReconnect ? 'Reconnect' : 'Manage'} ${title}: ${subtitle}`,
    busy,
    className: needsReconnect ? 'bg-[color-mix(in_srgb,var(--warning)_8%,var(--surface))]' : undefined,
    meta: (
      <>
        <StatusDot tone={needsReconnect ? 'warning' : connected ? 'success' : 'muted'}>{statusLabel}</StatusDot>
        {/* Shown at rest, above the item's click area, so Disconnect never
            opens the details. */}
        <ItemActions className="ml-auto">
          <Button variant="subtle" size="sm" onClick={() => { setError(''); setConfirming(true); }} disabled={busy}>
            {busy ? 'Removing…' : 'Disconnect'}
          </Button>
        </ItemActions>
      </>
    ),
    confirm: (
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
    ),
  };
}

export default function ConnectionCard(props) {
  const { confirm, ...slots } = useConnectionSlots(props);
  return (
    <>
      <ItemCard as="article" {...slots} />
      {confirm}
    </>
  );
}

export function ConnectionRow(props) {
  const { confirm, ...slots } = useConnectionSlots(props);
  return (
    <>
      <ListItem as="article" {...slots} />
      {confirm}
    </>
  );
}
