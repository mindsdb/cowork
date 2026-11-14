// `<ConnectionCard>` / `<ConnectionRow>` — one connected app as a grid card or
// a list row, built from one set of collection-kit slots, so the view toggle
// changes layout, not content.

import { useState } from 'react';
import { Badge, Button } from '../ui';
import { ItemActions, ItemCard, ListItem, StatusDot } from '../collection';
import { connectionIdentity, connectorInitials, humanLabel, isLegacyEngine } from '../../lib/connectionIdentity';
import { isDatasourceRow } from '../../lib/datasourceConnectionRows';
import { useConfirm } from '../ConfirmModal';
import i18n, { useTranslation } from '../../../lib/i18n';

function ConnectionLogo({ engine, label, custom, logoColor }) {
  const [failed, setFailed] = useState(null);
  if (custom) {
    return (
      <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-[13px] font-semibold" style={{ color: logoColor || 'var(--ink-2)' }}>
        {connectorInitials(label)}
      </span>
    );
  }
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

/* The confirm dialog's title and message before a delete. `shared` is the
   caller's own connection that others use: they read it live from its
   creator's vault (cowork-server's LayeredDataVault), so deleting it removes
   it for them too. The operator's share stays listed under its name, and
   cowork-server refuses a new connection under that name until the operator
   stops sharing it. */
export function disconnectPrompt({ engine, name, shared }) {
  const title = i18n.t('connectionCard.disconnectTitle', { ns: 'library', engine, name });
  return shared
    ? { title, message: i18n.t('connectionCard.disconnectShared', { ns: 'library' }) }
    : { title };
}

function useConnectionSlots({ connection, onDelete, onModify }) {
  const { t } = useTranslation('library');
  const [busy, setBusy] = useState(false);
  const [confirm, confirmModal] = useConfirm();
  const engine = connection.engine || 'unknown';
  const name = connection.name || connection.slug || 'unnamed';
  const { title, subtitle } = connectionIdentity(connection);
  const legacy = isLegacyEngine(engine);
  // The activator's own label is all a screen reader hears for the item.
  const describedTitle = connection.custom ? t('connectionCard.customTitle', { title }) : title;
  const repairHint = legacy ? t('connectionCard.repairHint') : '';
  const needsReconnect = connection.status === 'needs_reconnect';
  // The summary API omits status for healthy saved connections. Do not paint
  // an unfamiliar explicit status green as if we had checked it successfully
  // — a blank-but-present status ('') is unfamiliar too, not "no status".
  const connected = connection.status == null || connection.status === 'connected';
  const statusLabel = needsReconnect ? t('connectionCard.reconnectNeeded')
    : connected ? t('connections.connected') : humanLabel(connection.status);
  /* Only an explicit `managed: true` from the server makes the card read-only;
     a connection without the field keeps its Disconnect button. An explicit
     `shared: true` badges it Shared, whether someone else shares it with the
     caller (`managed` too, so read-only) or it's the caller's own that others
     use (keeps Disconnect). Managed is left for a connection the operator
     provides, which no person created. */
  const managed = connection.managed === true;
  const shared = connection.shared === true;
  const badge = shared ? t('share.shared') : managed ? t('connectionCard.managed') : null;

  const handleRemove = async () => {
    const prompt = disconnectPrompt({ engine, name, shared });
    const message = isDatasourceRow(connection)
      ? t('connectionCard.removeDatasource', { name: subtitle })
      : prompt.message;
    if (!(await confirm({ ...prompt, message, confirmLabel: t('connectionCard.disconnect'), destructive: true }))) return;
    setBusy(true);
    try {
      await onDelete?.(connection);
    } finally {
      setBusy(false);
    }
  };

  return {
    leading: <ConnectionLogo engine={engine} label={title} custom={connection.custom} logoColor={connection.logo_color} />,
    title,
    badges: connection.custom || badge ? (
      <>
        {connection.custom && <Badge variant="accent" size="xs">{t('connectionCard.custom')}</Badge>}
        {badge && <Badge variant="muted" size="sm">{badge}</Badge>}
      </>
    ) : undefined,
    description: subtitle,
    children: legacy
      ? <span className="text-xs text-ink-4">{t('connectionCard.legacy')}</span>
      : undefined,
    onActivate: typeof onModify === 'function' ? () => onModify(connection) : undefined,
    /* The details of a managed connection open read-only, with no Reconnect,
       so its name says View. */
    activateLabel: t('connectionCard.activateLabel', {
      action: managed ? 'view' : needsReconnect ? 'reconnect' : 'manage',
      title: describedTitle,
      subtitle,
      hint: repairHint,
    }),
    busy,
    className: needsReconnect ? 'bg-[color-mix(in_srgb,var(--warning)_8%,var(--surface))]' : undefined,
    meta: (
      <>
        <StatusDot tone={needsReconnect ? 'warning' : connected ? 'success' : 'muted'}>{statusLabel}</StatusDot>
        {/* Shown at rest, above the item's click area, so Disconnect never
            opens the details. */}
        {!managed && (
          <ItemActions className="ml-auto">
            <Button variant="subtle" size="sm" onClick={handleRemove} disabled={busy}>
              {busy ? t('connectionCard.removing') : t('connectionCard.disconnect')}
            </Button>
          </ItemActions>
        )}
        {confirmModal}
      </>
    ),
  };
}

export default function ConnectionCard(props) {
  return <ItemCard as="article" {...useConnectionSlots(props)} />;
}

export function ConnectionRow(props) {
  return <ListItem as="article" {...useConnectionSlots(props)} />;
}
