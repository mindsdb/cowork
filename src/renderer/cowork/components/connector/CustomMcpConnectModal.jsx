// Adding a remote MCP server by URL (desktop only). The app's main process
// logs in through the server's own login page, keeps the settings in the OS
// keychain and switches the read-only tools on; this form only collects the
// name, URL and an optional client, and shows every host that will receive
// login credentials before the browser opens. Mounted only while open, so a
// typed client secret goes away with it.

import { useState } from 'react';
import { Alert, Button, Collapsible, Field, Input } from '../ui';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../ui/Modal';
import { host } from '../../../platform/host';
import { useTranslation } from '../../../lib/i18n';

// Main's fixed loopback redirect for custom MCP servers (oauth-service.ts).
export const CUSTOM_MCP_REDIRECT_URI = 'http://127.0.0.1:47295/callback';

const EMPTY = { label: '', url: '', clientId: '', clientSecret: '' };

/**
 * The message for a refused connect, by the code main answered.
 *
 * @param {(key: string, values?: object) => string} t the `library` translator
 * @param {{code: string, reason?: string}} result
 * @returns {string}
 */
export function connectErrorMessage(t, result) {
  switch (result.code) {
    case 'invalid_url':
    case 'not_https':
    case 'invalid_request':
      return t('customMcp.error.invalidUrl');
    case 'not_public':
      return t('customMcp.error.notPublic');
    case 'unresolved':
      return t('customMcp.error.unresolved');
    case 'proxy_network':
      return t('customMcp.error.proxyNetwork');
    case 'needs_client_id':
      return t('customMcp.error.needsClientId');
    case 'timeout':
      return t('customMcp.error.timeout');
    case 'login_failed':
      return t('customMcp.error.loginFailed', { reason: result.reason || '' });
    case 'unavailable':
      return t('customMcp.error.unavailable');
    case 'keychain_unavailable':
      return t('customMcp.error.keychain');
    case 'server_changed':
      return t('customMcp.error.serverChanged');
    default:
      return t('customMcp.error.generic', { reason: result.reason || result.code });
  }
}

/**
 * Add a custom MCP server by URL.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(connected: {id: string, label: string}) => void} [props.onConnected]
 */
export default function CustomMcpConnectModal({ open, onClose, onConnected }) {
  const { t } = useTranslation('library');
  const [busy, setBusy] = useState(false);
  const close = busy ? undefined : onClose;
  return (
    <Modal open={open} onClose={close} closeOnBackdrop={!busy} closeOnEsc={!busy} size="sm" labelledBy="custom-mcp-title">
      <ModalHeader id="custom-mcp-title" title={t('customMcp.title')} subtitle={t('customMcp.subtitle')} onClose={close} />
      {open && <ConnectForm busy={busy} setBusy={setBusy} onClose={onClose} onConnected={onConnected} />}
    </Modal>
  );
}

/**
 * The form and its steps: the fields, then the login hosts to confirm when
 * the server asks for a login, then the result.
 */
function ConnectForm({ busy, setBusy, onClose, onConnected }) {
  const { t } = useTranslation('library');
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [loginHosts, setLoginHosts] = useState(null);
  const [connected, setConnected] = useState(null);

  const set = (field) => (next) => setValues((prev) => ({ ...prev, [field]: next }));
  const complete = Boolean(values.label.trim() && values.url.trim() && (!values.clientSecret || values.clientId.trim()));

  async function connect(confirmedLoginHosts) {
    setBusy(true);
    setError(null);
    try {
      const result = await host.customMcpConnect({
        label: values.label.trim(),
        url: values.url.trim(),
        ...(values.clientId.trim() ? { clientId: values.clientId.trim() } : {}),
        ...(values.clientSecret ? { clientSecret: values.clientSecret } : {}),
        ...(confirmedLoginHosts ? { confirmedLoginHosts } : {}),
      });
      if (result.ok) {
        setLoginHosts(null);
        setConnected(result);
        window.dispatchEvent(new CustomEvent('anton:connections-changed'));
        onConnected?.({ id: result.id, label: result.label });
      } else if (result.code === 'confirm_login_hosts') {
        setLoginHosts(result.loginHosts);
      } else {
        setLoginHosts(null);
        setError(connectErrorMessage(t, result));
      }
    } catch (err) {
      setLoginHosts(null);
      setError(t('customMcp.error.generic', { reason: err?.message || '' }));
    } finally {
      setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    if (!complete || busy) return;
    void connect(loginHosts ?? undefined);
  }

  if (connected) {
    return (
      <>
        <ModalBody>
          <Alert variant={connected.toolsUnavailable ? 'warning' : 'success'}>
            {connected.toolsUnavailable
              ? t('customMcp.toolsUnavailable')
              : t('customMcp.connected', { count: connected.toolsOn })}
          </Alert>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="primary" onClick={onClose}>{t('customMcp.done')}</Button>
        </ModalFooter>
      </>
    );
  }

  return (
    // The modal is a flex column capped in height; the form must be one too, or
    // ModalBody can't shrink to scroll and the footer is clipped.
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <ModalBody>
        <div className="flex flex-col gap-3">
          {error && <Alert variant="danger">{error}</Alert>}
          {loginHosts ? (
            <div className="flex flex-col gap-2" role="group" aria-label={t('customMcp.confirmHosts')}>
              <p className="text-sm text-ink">{t('customMcp.confirmHosts')}</p>
              <ul className="m-0 list-disc pl-5 text-sm font-medium text-ink">
                {loginHosts.map((loginHost) => <li key={loginHost}>{loginHost}</li>)}
              </ul>
              <p className="text-sm text-ink-2">{t('customMcp.confirmHostsHelp')}</p>
            </div>
          ) : (
            <>
              <Field label={t('customMcp.name')} help={t('customMcp.nameHelp')} required>
                <Input value={values.label} onChange={set('label')} disabled={busy} autoComplete="off" maxLength={128} />
              </Field>
              <Field label={t('customMcp.url')} help={t('customMcp.urlHelp')} required>
                <Input value={values.url} onChange={set('url')} disabled={busy} autoComplete="off" inputMode="url" />
              </Field>
              <Collapsible title={t('customMcp.advanced')} variant="compact">
                <div className="flex flex-col gap-3">
                  <Field label={t('customMcp.clientId')} help={t('customMcp.clientIdHelp')} optional>
                    <Input value={values.clientId} onChange={set('clientId')} disabled={busy} autoComplete="off" />
                  </Field>
                  <Field label={t('customMcp.clientSecret')} optional>
                    <Input type="password" value={values.clientSecret} onChange={set('clientSecret')} disabled={busy} autoComplete="new-password" />
                  </Field>
                  <p className="text-[12px] text-ink-2">
                    {t('customMcp.redirectUri')} <code className="select-all">{CUSTOM_MCP_REDIRECT_URI}</code>
                  </p>
                </div>
              </Collapsible>
            </>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        {loginHosts ? (
          <Button type="button" variant="subtle" onClick={() => setLoginHosts(null)} disabled={busy}>{t('customMcp.back')}</Button>
        ) : (
          <Button type="button" variant="subtle" onClick={onClose} disabled={busy}>{t('skillModal.cancel')}</Button>
        )}
        <Button type="submit" variant="primary" disabled={!complete || busy}>
          {busy ? t('customMcp.connecting') : loginHosts ? t('customMcp.continue') : t('customMcp.connect')}
        </Button>
      </ModalFooter>
    </form>
  );
}
