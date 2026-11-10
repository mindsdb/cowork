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
import { ConfirmModal } from '../ConfirmModal';
import { describeConnectionState } from '../../lib/datasourceSubmission';
import { useTranslation } from '../../../lib/i18n';

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
// Catalog keys under datasource.trust.<mode>.label / .note.
const TRUST_MODES = new Set(['prefer', 'system', 'custom_ca', 'encrypted', 'disabled']);

export default function DatasourceDetailPanel({ connection, onClose, onRetry, onRemove, onEdit }) {
  const { t } = useTranslation('library');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  // Its own error, so a failed removal is answered inside the dialog the user
  // is looking at rather than behind it.
  const [removeError, setRemoveError] = useState('');

  if (!connection) return null;

  const failed = connection.status === 'failed';
  // Auth stores only that validation failed; the gateway's code is what turns
  // that into something to act on.
  const failedState = describeConnectionState({ status: 'failed', validation_code: connection.validationCode });
  const pending = connection.status === 'pending';

  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e?.message || t('datasource.failed'));
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    setBusy(true);
    setRemoveError('');
    try {
      await onRemove?.(connection);
      setConfirming(false);
    } catch (e) {
      setRemoveError(e?.message || t('datasource.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        role="dialog"
        aria-label={t('datasource.ariaLabel', { name: connection.name })}
        className="fixed inset-y-0 right-0 z-30 w-[min(420px,92vw)] bg-surface border-l border-line shadow-xl flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="min-w-0">
            <div className="s-h3 truncate">{connection.name}</div>
            <div className="text-[12px] text-ink-4">{connection.engine}</div>
          </div>
          <Button variant="subtle" onClick={onClose} aria-label={t('connections.close')}>{Ico.close(14)}</Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {pending && (
            <Alert variant="info">
              {t('datasource.pending')}
            </Alert>
          )}
          {failed && (
            <Alert variant="danger" title={t('datasource.couldNotConnect')}>
              {failedState.hint || connection.validationError || t('datasource.lastCheckFailed')}
            </Alert>
          )}
          {error && <Alert variant="danger">{error}</Alert>}

          <div className="mt-3">
            <Row label={t('datasource.host')} value={connection.hostMasked} />
            <Row label={t('datasource.port')} value={connection.port} />
            <Row label={t('datasource.database')} value={connection.database} />
            <Row label={t('datasource.schema')} value={connection.dbSchema} />
            <Row label={t('datasource.username')} value={connection.username} />
            <Row label={t('datasource.certificateTrust')} value={(TRUST_MODES.has(connection.tlsMode) ? t(`datasource.trust.${connection.tlsMode}.label`) : null) || connection.tlsMode || '—'} />
          </div>

          <p className="mt-4 text-[12px] text-ink-4 leading-[1.6]">
            {t('datasource.passwordNote')}
            {' '}{t(`datasource.trust.${TRUST_MODES.has(connection.tlsMode) ? connection.tlsMode : 'prefer'}.note`)}
          </p>
        </div>

        {/* Left-aligned: the window's own controls sit in the bottom right corner
            and covered the last button here. */}
        <div className="flex justify-start gap-2 px-5 py-4 border-t border-line">
          {failed && (
            <Button variant="default" disabled={busy} onClick={() => run(() => onRetry?.(connection))}>
              {busy ? t('datasource.working') : t('datasource.tryAgain')}
            </Button>
          )}
          <Button variant="default" disabled={busy} onClick={() => onEdit?.(connection)}>{t('skills.menu.edit')}</Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => { setRemoveError(''); setConfirming(true); }}
          >
            {t('recipients.removeTooltip')}
          </Button>
        </div>
      </div>
      <ConfirmModal
        open={confirming}
        title={t('datasource.removeTitle', { name: connection.name })}
        message={t('datasource.removeMessage')}
        confirmLabel={t('recipients.removeTooltip')}
        busyLabel={t('connectionCard.removing')}
        destructive
        busy={busy}
        error={removeError}
        onConfirm={confirmRemove}
        onClose={() => { setConfirming(false); setRemoveError(''); }}
      />
    </>
  );
}
