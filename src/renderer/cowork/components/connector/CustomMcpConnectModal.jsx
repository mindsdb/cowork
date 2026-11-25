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
import { CUSTOM_MCP_REDIRECT_URI } from '../../../../shared/custom-mcp';

export { CUSTOM_MCP_REDIRECT_URI } from '../../../../shared/custom-mcp';

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
      return t('customMcp.error.invalidUrl');
    case 'invalid_request':
      return t('customMcp.error.invalidRequest', { reason: result.reason || '' });
    case 'not_public':
    case 'refused_address':
      return t('customMcp.error.notPublic');
    case 'unresolved':
      return t('customMcp.error.unresolved');
    case 'proxy_network':
      return t('customMcp.error.proxyNetwork');
    case 'needs_client_id':
      return t('customMcp.error.needsClientId');
    case 'timeout':
      return t('customMcp.error.timeout');
    case 'grant_refused':
    case 'login_failed':
      return t('customMcp.error.loginFailed', { reason: result.reason || '' });
    case 'client_refused':
      return t('customMcp.error.clientRefused', { redirectUri: CUSTOM_MCP_REDIRECT_URI });
    case 'login_cancelled':
      return t('customMcp.error.loginCancelled');
    case 'login_timed_out':
      return t('customMcp.error.loginTimedOut');
    case 'login_refused':
      return t('customMcp.error.loginRefused');
    case 'login_denied':
      return t('customMcp.error.loginDenied');
    case 'login_unavailable':
      return t('customMcp.error.loginUnavailable');
    case 'unavailable':
      return t('customMcp.error.unavailable');
    case 'keychain_unavailable':
      return t('customMcp.error.keychain');
    case 'server_changed':
      return t('customMcp.error.serverChanged');
    case 'token_rejected':
      return t('customMcp.error.tokenRejected');
    case 'unreachable':
      return t('customMcp.error.unreachable');
    case 'not_handed_over':
      return t('customMcp.error.notHandedOver');
    case 'custom_connection_missing':
      return t('customMcp.error.missing');
    case 'custom_connection_unreadable':
      return t('customMcp.error.unreadable');
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
  // The hosts the user confirmed for a login the server refused before the
  // browser opened; "Open the browser anyway" sends them again with the skip.
  const [refusedHosts, setRefusedHosts] = useState(null);
  // True while a call that may open the browser runs: one with confirmed hosts.
  const [loggingIn, setLoggingIn] = useState(false);
  const [connected, setConnected] = useState(null);

  const set = (field) => (next) => {
    setRefusedHosts(null);
    setValues((prev) => ({ ...prev, [field]: next }));
  };
  const complete = Boolean(values.label.trim() && values.url.trim() && (!values.clientSecret || values.clientId.trim()));

  /**
   * Asks main to connect with the current fields.
   *
   * @param {string[]} [confirmedLoginHosts] the hosts the user confirmed
   * @param {boolean} [skipClientCheck] open the browser even though the login server refused the client
   */
  async function connect(confirmedLoginHosts, skipClientCheck = false) {
    setBusy(true);
    setLoggingIn(Boolean(confirmedLoginHosts));
    setError(null);
    setRefusedHosts(null);
    try {
      const result = await host.customMcpConnect({
        label: values.label.trim(),
        url: values.url.trim(),
        ...(values.clientId.trim() ? { clientId: values.clientId.trim() } : {}),
        ...(values.clientSecret ? { clientSecret: values.clientSecret } : {}),
        ...(confirmedLoginHosts ? { confirmedLoginHosts } : {}),
        ...(skipClientCheck ? { skipClientCheck: true } : {}),
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
        if (result.code === 'client_refused' && confirmedLoginHosts) setRefusedHosts(confirmedLoginHosts);
        setError(connectErrorMessage(t, result));
      }
    } catch (err) {
      setLoginHosts(null);
      setError(t('customMcp.error.generic', { reason: err?.message || '' }));
    } finally {
      setBusy(false);
      setLoggingIn(false);
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
          {refusedHosts && !busy && (
            <div>
              <Button type="button" variant="default" size="sm" onClick={() => void connect(refusedHosts, true)}>{t('customMcp.openBrowserAnyway')}</Button>
            </div>
          )}
          {busy && loggingIn && <p className="text-sm text-ink-2" role="status">{t('customMcp.loginWaiting')}</p>}
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
        {busy ? (
          // The browser login can wait minutes; cancelling ends it, and the connect reports it.
          <Button type="button" variant="subtle" onClick={() => void host.oauthCancel()}>{t('skillModal.cancel')}</Button>
        ) : loginHosts ? (
          <Button type="button" variant="subtle" onClick={() => setLoginHosts(null)}>{t('customMcp.back')}</Button>
        ) : (
          <Button type="button" variant="subtle" onClick={onClose}>{t('skillModal.cancel')}</Button>
        )}
        <Button type="submit" variant="primary" disabled={!complete || busy}>
          {busy ? t('customMcp.connecting') : loginHosts ? t('customMcp.continue') : t('customMcp.connect')}
        </Button>
      </ModalFooter>
    </form>
  );
}
