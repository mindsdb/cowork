// What a cloud database connection shows when you open it.
//
// Everything here comes from the relay's own response, which never carries a
// credential: the host arrives already masked, and the password exists only
// in auth. A failed check can be retried; a connection can be removed. Edits
// re-open the connect form, because the relay requires the password on every
// edit and there is nothing here to pre-fill it with.

import { useState } from 'react';
import Ico from '../Icons';
import { Alert, Button } from '../ui';

function Row({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-baseline gap-3 py-1">
      <div className="w-[130px] shrink-0 text-[12px] text-ink-4">{label}</div>
      <div className="min-w-0 flex-1 text-[13px] text-ink break-words">{value}</div>
    </div>
  );
}

export default function DatasourceDetailPanel({ connection, onClose, onRetry, onRemove, onEdit }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!connection) return null;

  const failed = connection.status === 'failed';
  const pending = connection.status === 'pending';

  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e?.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={`${connection.name} connection`}
      className="fixed inset-y-0 right-0 z-30 w-[min(420px,92vw)] bg-surface border-l border-line shadow-xl flex flex-col"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-line">
        <div className="min-w-0">
          <div className="s-h3 truncate">{connection.name}</div>
          <div className="text-[12px] text-ink-4">{connection.engine}</div>
        </div>
        <Button variant="subtle" onClick={onClose} aria-label="Close">{Ico.close(14)}</Button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {pending && (
          <Alert variant="info">
            Checking the connection. Your credentials are stored encrypted; this updates when the check finishes.
          </Alert>
        )}
        {failed && (
          <Alert variant="danger" title="Could not connect">
            {connection.validationError || 'The last check did not succeed.'}
          </Alert>
        )}
        {error && <Alert variant="danger">{error}</Alert>}

        <div className="mt-3">
          <Row label="Host" value={connection.hostMasked} />
          <Row label="Port" value={connection.port} />
          <Row label="Database" value={connection.database} />
          <Row label="Username" value={connection.username} />
          <Row
            label="Certificate trust"
            value={connection.tlsMode === 'custom_ca' ? 'Custom CA certificate' : 'Public certificate authorities'}
          />
        </div>

        <p className="mt-4 text-[12px] text-ink-4 leading-[1.6]">
          The password is held encrypted by the server and is never shown again. Queries run read only over a
          verified TLS connection; the certificate chain and the hostname are always checked.
        </p>
      </div>

      <div className="flex justify-end gap-2 px-5 py-4 border-t border-line">
        {failed && (
          <Button variant="default" disabled={busy} onClick={() => run(() => onRetry?.(connection))}>
            {busy ? 'Working…' : 'Try again'}
          </Button>
        )}
        <Button variant="default" disabled={busy} onClick={() => onEdit?.(connection)}>Edit</Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(`Remove ${connection.name}?`)) return;
            run(() => onRemove?.(connection));
          }}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}
