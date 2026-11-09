// Inline connector template card + details modal.
//
// Rendered for a template a cloud turn built (a `response.connector_drafted`
// step, badge 'Connector'). The template is model-written, so every field shows
// as plain text: no Markdown, and the help link is not a link. Nothing is kept
// until the member presses Save, which stores it as their own connector. Once
// saved, Connect opens its connect form, which never sends to the chat.

import { useEffect, useState } from 'react';

import Ico from './Icons';
import Button from './ui/Button';
import { Card } from './ui/Card';
import { Modal, ModalHeader, ModalBody } from './ui/Modal';
import { fetchConnectorDraftSaved, saveConnectorDraft } from '../api';

const SAVED_TEXT = 'Saved. Add your credentials in Connect Apps and Data.';
const SAVED_CONNECT_TEXT = 'Saved. Connect it to add your credentials.';
const KEPT_TEXT = 'You already keep a connector with this id. Saving again replaces it.';

function text(value) {
  return typeof value === 'string' ? value : '';
}

function FieldRow({ field }) {
  const notes = [field.secret ? 'secret' : null, field.required ? 'required' : 'optional'].filter(Boolean);
  return (
    <li style={{ marginBottom: 8 }}>
      <div style={{ color: 'var(--ink)' }}>
        {text(field.label)} <span style={{ color: 'var(--ink-3)' }}>({text(field.name)}, {notes.join(', ')})</span>
      </div>
      {text(field.placeholder) && (
        <div style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>Example: {text(field.placeholder)}</div>
      )}
      {text(field.help) && <div style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>{text(field.help)}</div>}
    </li>
  );
}

function ConnectorDraftModal({ connector, open, onClose }) {
  const fields = Array.isArray(connector.fields) ? connector.fields : [];
  return (
    <Modal open={open} onClose={onClose} width="min(640px, 92vw)" labelledBy="connector-draft-modal-title">
      <ModalHeader
        id="connector-draft-modal-title"
        title={text(connector.label) || text(connector.connector_id)}
        subtitle={text(connector.description) || undefined}
        onClose={onClose}
      />
      <ModalBody padding="20px 22px">
        {/* Opt back into text selection; the app root sets user-select:none. */}
        <div style={{ userSelect: 'text', fontSize: 13.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          <div className="s-h3" style={{ marginBottom: 6 }}>What you will enter</div>
          <ul style={{ margin: '0 0 16px', paddingLeft: 18 }}>
            {fields.map((f) => <FieldRow key={text(f.name)} field={f} />)}
          </ul>
          {text(connector.help_url) && (
            <div style={{ marginBottom: 16 }}>Where to find them: {text(connector.help_url)}</div>
          )}
          {text(connector.usage_notes) && (
            <>
              <div className="s-h3" style={{ marginBottom: 6 }}>How Anton will use it</div>
              <div>{text(connector.usage_notes)}</div>
            </>
          )}
        </div>
      </ModalBody>
    </Modal>
  );
}

export default function ConnectorDraftCard({ connector, onConnect }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [kept, setKept] = useState(false);
  const [status, setStatus] = useState(null); // { kind: 'ok'|'error', text }
  const id = text(connector.connector_id);

  // A connector kept under this id may be an earlier template, which a later
  // turn corrected, so it only changes the wording; Save stays available.
  useEffect(() => {
    let live = true;
    if (!id) return undefined;
    fetchConnectorDraftSaved(id).then((isKept) => {
      if (live && isKept === true) setKept(true);
    });
    return () => { live = false; };
  }, [id]);

  const handleSave = async (e) => {
    e?.stopPropagation?.();
    if (saving || saved) return;
    setSaving(true);
    setStatus(null);
    try {
      await saveConnectorDraft(connector);
      setSaved(true);
      setStatus({ kind: 'ok', text: onConnect ? SAVED_CONNECT_TEXT : SAVED_TEXT });
    } catch (err) {
      setStatus({ kind: 'error', text: err?.message || 'Could not save the connector.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card padding="compact" interactive onActivate={() => setOpen(true)} style={{ marginTop: 4 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr auto', alignItems: 'center', gap: 14 }}>
          <div
            aria-hidden="true"
            style={{
              width: 56, height: 56, borderRadius: 'var(--r-lg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent)', background: 'var(--surface-2)', border: '1px solid var(--line)',
            }}
          >
            {Ico.link(20)}
          </div>

          <div style={{ minWidth: 0 }}>
            <div className="s-h3" style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {text(connector.label) || id}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
              {status ? (
                <span style={{ color: status.kind === 'error' ? 'var(--danger)' : 'var(--success, #1F8F5F)' }}>
                  {status.text}
                </span>
              ) : kept ? KEPT_TEXT : 'Connector template · not saved'}
            </div>
          </div>

          {saved && onConnect ? (
            <Button
              size="sm"
              variant="primary"
              onClick={(e) => {
                e?.stopPropagation?.();
                onConnect({ id, label: text(connector.label) || id });
              }}
            >
              Connect
            </Button>
          ) : (
            <Button
              size="sm"
              variant={saved ? 'subtle' : 'primary'}
              disabled={saving || saved || !id}
              onClick={handleSave}
            >
              {saved ? 'Saved' : saving ? 'Saving…' : kept ? 'Save again' : 'Save connector'}
            </Button>
          )}
        </div>
      </Card>

      <ConnectorDraftModal connector={connector} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
