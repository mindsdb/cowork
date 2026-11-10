// What the user answers before a custom connector is saved: allow a private
// address for this test, or confirm that what came back is their data.
//
// Only app text and what the server measured appear here, never the form's
// own title, description, how_to or help_url: the agent writes those, and
// they must not be able to argue the user into allowing or confirming. The
// preview is rendered as text.

import { Alert, Button } from '../ui';

function Row({ label, children }) {
  return (
    <div className="flex gap-2 text-sm leading-[1.5]">
      <span className="text-ink-3 w-[96px] shrink-0">{label}</span>
      <span className="text-ink-2 min-w-0 break-words">{children}</span>
    </div>
  );
}

function PrivateHostQuestion({ host }) {
  const where = host.this_computer ? 'this computer' : 'your private network';
  const shownHost = host.host_ascii && host.host_ascii !== host.host ? `${host.host} (${host.host_ascii})` : host.host;
  return (
    <div className="flex flex-col gap-2">
      <div className="s-h3">Allow a private address?</div>
      <div className="text-sm text-ink-2 leading-[1.55]">
        Cowork wants to send <code>{host.method} {host.path}</code> to <code>{shownHost}:{host.port}</code>,
        which is on {where} ({(host.addresses || []).join(', ')}). Allow it for this test?
      </div>
    </div>
  );
}

function TestPreview({ preview }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="s-h3">Is this your data?</div>
      <div className="text-sm text-ink-2 leading-[1.55]">
        Cowork tested the connection. Check what came back before it is saved.
        Values you entered are hidden as ***.
      </div>
      <div className="flex flex-col gap-1">
        {preview.token_host && <Row label="Token from">{preview.token_host}</Row>}
        <Row label="Data from">{preview.data_host}</Row>
        <Row label="Answer">HTTP {preview.status}, {preview.size} bytes{preview.content_type ? `, ${preview.content_type}` : ''}</Row>
        {preview.item_count != null && <Row label="Items">{preview.item_count}</Row>}
        {preview.keys?.length > 0 && <Row label="Fields">{preview.keys.join(', ')}</Row>}
        {preview.masked_count > 0 && <Row label="Hidden">{preview.masked_count} value(s)</Row>}
      </div>
      {preview.over_cap ? (
        <Alert variant="info">The answer is too large to show. Confirm only if you expected a large answer from this API.</Alert>
      ) : preview.first_item != null && (
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
  const approval = pending.kind === 'approval';
  return (
    <div className="flex flex-col gap-[14px] font-[family-name:var(--font-body)] py-[14px] px-0">
      {approval ? <PrivateHostQuestion host={pending.host || {}} /> : <TestPreview preview={pending.preview || {}} />}
      {error && <Alert variant="danger">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="subtle" disabled={busy} onClick={() => onCancel?.()}>
          {approval ? "Don't allow" : 'Cancel'}
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => (approval ? onAllow : onConfirm)?.()}>
          {busy ? 'Working…' : approval ? 'Allow for this test' : 'Confirm and save'}
        </Button>
      </div>
    </div>
  );
}
