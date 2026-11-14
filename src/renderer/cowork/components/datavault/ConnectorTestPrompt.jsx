// What the user answers before a custom connector is saved: allow a private
// address for this test, or confirm that what came back is their data.
//
// Only app text and what the server measured appear here, never the form's
// own title, description, how_to or help_url: the agent writes those, and
// they must not be able to argue the user into allowing or confirming. The
// preview is rendered as text.

import { Alert, Button } from '../ui';
import { useTranslation } from '../../../lib/i18n';
import { productName } from '../../../lib/deploymentBrand';

// Stand-ins for the two <code> parts of the private-address question, so the
// sentence stays one message in the catalog and each language orders it.
const REQUEST_TOKEN = '\uE000';
const TARGET_TOKEN = '\uE001';

function Row({ label, children }) {
  return (
    <div className="flex gap-2 text-sm leading-[1.5]">
      <span className="text-ink-3 w-[96px] shrink-0">{label}</span>
      <span className="text-ink-2 min-w-0 break-words">{children}</span>
    </div>
  );
}

function PrivateHostQuestion({ host }) {
  const { t } = useTranslation('library');
  const where = host.this_computer ? t('dataVault.connectionTest.thisComputer') : t('dataVault.connectionTest.privateNetwork');
  const shownHost = host.host_ascii && host.host_ascii !== host.host ? `${host.host} (${host.host_ascii})` : host.host;
  return (
    <div className="flex flex-col gap-2">
      <div className="s-h3">{t('dataVault.connectionTest.privateTitle')}</div>
      <div className="text-sm text-ink-2 leading-[1.55]">
        {t('dataVault.connectionTest.privateBody', {
          product: productName('Cowork'),
          request: REQUEST_TOKEN,
          target: TARGET_TOKEN,
          where,
          addresses: (host.addresses || []).join(', '),
        }).split(/(\uE000|\uE001)/).map((part, i) => {
          if (part === REQUEST_TOKEN) return <code key={i}>{host.method} {host.path}</code>;
          if (part === TARGET_TOKEN) return <code key={i}>{shownHost}:{host.port}</code>;
          return part;
        })}
      </div>
    </div>
  );
}

function TestPreview({ preview }) {
  const { t } = useTranslation('library');
  return (
    <div className="flex flex-col gap-2">
      <div className="s-h3">{t('dataVault.connectionTest.previewTitle')}</div>
      <div className="text-sm text-ink-2 leading-[1.55]">
        {t('dataVault.connectionTest.previewBody', { product: productName('Cowork') })}
      </div>
      <div className="flex flex-col gap-1">
        {preview.token_host && <Row label={t('dataVault.connectionTest.tokenFrom')}>{preview.token_host}</Row>}
        <Row label={t('dataVault.connectionTest.dataFrom')}>{preview.data_host}</Row>
        <Row label={t('dataVault.connectionTest.answer')}>{t('dataVault.connectionTest.answerValue', { status: preview.status, size: preview.size })}{preview.content_type ? `, ${preview.content_type}` : ''}</Row>
        {preview.item_count != null && <Row label={t('dataVault.connectionTest.items')}>{preview.item_count}</Row>}
        {preview.keys?.length > 0 && <Row label={t('dataVault.connectionTest.fields')}>{preview.keys.join(', ')}</Row>}
        {preview.masked_count > 0 && <Row label={t('dataVault.connectionTest.hidden')}>{t('dataVault.connectionTest.hiddenValue', { count: preview.masked_count })}</Row>}
      </div>
      {preview.first_item != null && (
        <pre
          data-testid="connector-test-preview-item"
          className="m-0 p-[10px] rounded-card-row text-[12px] leading-[1.5] text-ink-2 whitespace-pre-wrap break-words max-h-[220px] overflow-auto"
          style={{ background: 'var(--surface-2)' }}
        >{preview.first_item}</pre>
      )}
    </div>
  );
}

export function ConnectorTestPrompt({ pending, busy = false, error = '', onAllow, onConfirm, onCancel }) {
  const { t } = useTranslation('library');
  const approval = pending.kind === 'approval';
  return (
    <div className="flex flex-col gap-[14px] font-[family-name:var(--font-body)] py-[14px] px-0">
      {approval ? <PrivateHostQuestion host={pending.host || {}} /> : <TestPreview preview={pending.preview || {}} />}
      {error && <Alert variant="danger">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="subtle" disabled={busy} onClick={() => onCancel?.()}>
          {approval ? t('dataVault.connectionTest.dontAllow') : t('dataVault.connectionTest.cancel')}
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => (approval ? onAllow : onConfirm)?.()}>
          {busy ? t('dataVault.connectionTest.working') : approval ? t('dataVault.connectionTest.allow') : t('dataVault.connectionTest.confirm')}
        </Button>
      </div>
    </div>
  );
}
