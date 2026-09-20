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
import { describeConnectionState } from '../../lib/datasourceSubmission';

function Row({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-baseline gap-3 py-1">
      <div className="w-[130px] shrink-0 text-[12px] text-ink-4">{label}</div>
      <div className="min-w-0 flex-1 text-[13px] text-ink break-words">{value}</div>
    </div>
  );
}

// The same words the connect form offers, because this is where someone comes
// to check what a connection actually does. Showing every mode that is not a
// custom CA as the public trust store would tell the owner of an unverified
// connection the opposite of the truth.
const TRUST_LABELS = {
  prefer: 'Encrypted when the server offers it',
  system: 'Public certificate authorities',
  custom_ca: 'A CA certificate you provided',
  encrypted: 'Encrypted, certificate not checked',
  disabled: 'No encryption',
};

const TRUST_NOTES = {
  prefer: 'The connection is encrypted when the server supports it, and the server is not identified, so '
    + 'the credentials could reach whoever answered for that address.',
  system: 'The connection is encrypted and the server\'s certificate and hostname are checked.',
  custom_ca: 'The connection is encrypted and checked against the certificate authority you provided.',
  encrypted: 'The connection is encrypted, but the server is not identified, so the credentials could reach '
    + 'whoever answered for that address.',
  disabled: 'The connection is not encrypted: the credentials, the queries and the rows they return travel '
    + 'in clear text and can be read by anyone on the path.',
};

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
            {describeConnectionState({ status: 'failed', validation_code: connection.validationCode }).hint && (
              <div className="text-sm text-ink-2 leading-[1.55] mt-[6px]">
                {describeConnectionState({ status: 'failed', validation_code: connection.validationCode }).hint}
              </div>
            )}
          </Alert>
        )}
        {error && <Alert variant="danger">{error}</Alert>}

        <div className="mt-3">
          <Row label="Host" value={connection.hostMasked} />
          <Row label="Port" value={connection.port} />
          <Row label="Database" value={connection.database} />
          <Row label="Username" value={connection.username} />
          <Row label="Certificate trust" value={TRUST_LABELS[connection.tlsMode] || connection.tlsMode || '—'} />
        </div>

        <p className="mt-4 text-[12px] text-ink-4 leading-[1.6]">
          The password is held encrypted by the server and is never shown again. Queries run read only.
          {' '}{TRUST_NOTES[connection.tlsMode] || TRUST_NOTES.prefer}
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
