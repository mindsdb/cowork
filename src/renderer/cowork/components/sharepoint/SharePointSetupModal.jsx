// SharePoint connection setup: an admin's Entra app key and the sites it may
// read. It saves only through the SharePoint routes, which check the key with
// Microsoft before storing anything, never through the generic connector
// save. The form is mounted only while the modal is open, so a typed client
// secret is dropped on save, cancel or close.

import { useEffect, useState } from 'react';
import { Alert, Button, Field, Input, Textarea } from '../ui';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../ui/Modal';
import HowToModal from '../datavault/HowToModal';
import {
  CONNECTIONS_VAULT_KEEP,
  createSharePointConnection,
  editSharePointConnection,
  fetchConnector,
  fetchSavedConnection,
} from '../../api';

export const SHAREPOINT_ENGINE = 'sharepoint';

const BUILT_IN_HELP =
  'An admin registers an app in Microsoft Entra with the Graph application permission Sites.Selected, '
  + 'grants admin consent, creates a client secret, and gives the app read access to each site listed here.';

const EMPTY = { name: '', userLabel: '', tenantId: '', clientId: '', siteUrls: '' };

/**
 * Create or edit a SharePoint connection.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string|null} [props.name] the saved connection to edit; omit to create one
 * @param {() => void} props.onClose
 * @param {(saved: {name: string, user_label: string|null}) => void} [props.onSaved]
 */
export default function SharePointSetupModal({ open, name = null, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const editing = Boolean(name);
  const close = busy ? undefined : onClose;
  return (
    <Modal
      open={open}
      onClose={close}
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
      size="sm"
      labelledBy="sharepoint-setup-title"
    >
      <ModalHeader
        id="sharepoint-setup-title"
        title={editing ? 'Edit SharePoint connection' : 'Connect SharePoint'}
        subtitle="Cowork checks the key with Microsoft before saving it."
        onClose={close}
      />
      {open && (
        <SetupForm name={name} busy={busy} setBusy={setBusy} onCancel={onClose} onSaved={onSaved} />
      )}
    </Modal>
  );
}

function SetupForm({ name, busy, setBusy, onCancel, onSaved }) {
  const editing = Boolean(name);
  const [values, setValues] = useState(EMPTY);
  const [secret, setSecret] = useState('');
  const [secretSaved, setSecretSaved] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [error, setError] = useState(null);
  const [howTo, setHowTo] = useState(null);
  const [howToOpen, setHowToOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetchConnector(SHAREPOINT_ENGINE)
      .then((spec) => {
        const method = spec?.form?.methods?.[0];
        if (active && typeof method?.how_to === 'string' && method.how_to.trim()) setHowTo(method.how_to);
      })
      // A server without the SharePoint spec answers 404; the built-in help covers it.
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!editing) return undefined;
    let active = true;
    fetchSavedConnection(SHAREPOINT_ENGINE, name)
      .then((saved) => {
        if (!active) return;
        const fields = saved?.fields || {};
        setValues({
          name,
          userLabel: saved?.user_label || '',
          tenantId: String(fields.tenant_id || ''),
          clientId: String(fields.client_id || ''),
          siteUrls: String(fields.site_urls || ''),
        });
        setSecretSaved(fields.client_secret === CONNECTIONS_VAULT_KEEP);
      })
      .catch((err) => { if (active) setError(err?.message || 'The saved connection could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [editing, name]);

  const set = (field) => (next) => setValues((prev) => ({ ...prev, [field]: next }));
  const clientSecret = secret || (editing && secretSaved ? CONNECTIONS_VAULT_KEEP : '');
  const complete = Boolean(
    (editing || values.name.trim())
    && values.tenantId.trim()
    && values.clientId.trim()
    && clientSecret
    && values.siteUrls.trim(),
  );

  async function save(event) {
    event.preventDefault();
    if (!complete || busy) return;
    const key = {
      userLabel: values.userLabel.trim(),
      tenantId: values.tenantId.trim(),
      clientId: values.clientId.trim(),
      clientSecret,
      siteUrls: values.siteUrls,
    };
    setBusy(true);
    setError(null);
    try {
      const saved = editing
        ? await editSharePointConnection(name, key)
        : await createSharePointConnection({ name: values.name.trim(), ...key });
      window.dispatchEvent(new CustomEvent('anton:connections-changed'));
      onSaved?.(saved);
    } catch (err) {
      setError(err?.message || 'SharePoint could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <ModalBody>
        <div className="flex flex-col gap-3">
          {error && <Alert variant="danger">{error}</Alert>}
          <p className="text-sm text-ink-2">
            {BUILT_IN_HELP}{' '}
            {howTo && (
              <button type="button" className="text-accent underline" onClick={() => setHowToOpen(true)}>
                Setup steps
              </button>
            )}
          </p>
          {!editing && (
            <Field label="Connection name" help="Letters and digits, joined by single - or _." required>
              <Input value={values.name} onChange={set('name')} disabled={busy} autoComplete="off" />
            </Field>
          )}
          <Field label="Label" optional>
            <Input value={values.userLabel} onChange={set('userLabel')} disabled={busy || loading} autoComplete="off" />
          </Field>
          <Field label="Directory (tenant) ID" required>
            <Input value={values.tenantId} onChange={set('tenantId')} disabled={busy || loading} autoComplete="off" />
          </Field>
          <Field label="Application (client) ID" required>
            <Input value={values.clientId} onChange={set('clientId')} disabled={busy || loading} autoComplete="off" />
          </Field>
          <Field
            label="Client secret"
            help={editing && secretSaved ? 'Saved. Leave empty to keep it.' : undefined}
            required={!(editing && secretSaved)}
          >
            <Input
              type="password"
              value={secret}
              onChange={setSecret}
              disabled={busy || loading}
              autoComplete="new-password"
              placeholder={editing && secretSaved ? '••••••••' : undefined}
            />
          </Field>
          <Field label="Site addresses" help="One per line, such as https://contoso.sharepoint.com/sites/team." required>
            <Textarea value={values.siteUrls} onChange={set('siteUrls')} rows={3} disabled={busy || loading} />
          </Field>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="subtle" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!complete || busy || loading}>
          {busy ? 'Checking…' : 'Save'}
        </Button>
      </ModalFooter>
      <HowToModal
        open={howToOpen}
        title="How to · SharePoint"
        content={howTo || ''}
        onClose={() => setHowToOpen(false)}
      />
    </form>
  );
}
