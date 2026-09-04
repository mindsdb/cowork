import { useMemo, useRef, useState } from 'react';

import {
  deleteDatasource,
  fetchConnector,
  fetchDatasources,
  fetchSavedConnection,
  validateAndSaveConnector,
  type ConnectorConnection,
  type ConnectorSpec,
} from '../api';
import { ConfirmModal } from '../components/ConfirmModal';
import { DataVaultForm } from '../components/datavault/DataVaultForm';
import Ico from '../components/Icons';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Modal, { ModalBody, ModalHeader } from '../components/ui/Modal';
import { host } from '../../platform/host';
import type { CodeProject } from './api';

type ProviderId = 'github' | 'linear';

type CredentialSetup = {
  provider: ProviderId;
  connectionName: string;
  method: string;
  formSpec: Record<string, unknown>;
};

type FormAction = {
  kind?: string;
  values?: Record<string, unknown>;
  authMethod?: string | null;
};

const PROVIDERS: Array<{
  id: ProviderId;
  label: string;
  description: string;
  logo: string;
}> = [
  {
    id: 'github',
    label: 'GitHub',
    description: 'Start from issues, create draft pull requests, and follow reviews and checks.',
    logo: 'logos/github.svg',
  },
  {
    id: 'linear',
    label: 'Linear',
    description: 'Start from Linear issues and post progress back to them.',
    logo: 'logos/linear.svg',
  },
];

function connectionLabel(connection: ConnectorConnection): string {
  return connection.display_name || connection.user_label || connection.label || connection.name;
}

function projectUsage(projects: CodeProject[], provider: ProviderId, name: string): number {
  return projects.filter((project) => (
    project.connections.some((connection) => connection.provider === provider && connection.name === name)
  )).length;
}

function usageLabel(count: number): string {
  if (count === 0) return 'Not used by a project';
  return `Used by ${count} ${count === 1 ? 'project' : 'projects'}`;
}

function oauthCredentialsMissing(result: { code?: string; reason?: string } | null | undefined): boolean {
  if (result?.code === 'oauth_credentials_missing') return true;
  // Renderer and Electron shell can update independently. Keep the fallback
  // working with an older shell that predates the structured error code.
  return /oauth credentials (?:are )?not configured/i.test(result?.reason || '');
}

function personalCredentialForm(provider: ProviderId, spec: ConnectorSpec): CredentialSetup {
  const methodId = provider === 'github' ? 'fine-grained-pat' : 'personal-api-key';
  const method = spec.form.methods?.find((candidate) => candidate.id === methodId);
  if (!method) throw new Error(`Could not load ${provider === 'github' ? 'GitHub' : 'Linear'} connection options.`);
  return {
    provider,
    connectionName: '',
    method: methodId,
    formSpec: {
      ...spec.form,
      _connector_id: provider,
      engine: provider,
      logo_url: spec.logo_url || spec.form?.logo_url,
      selected_method: methodId,
      methods: [{
        ...method,
        recommended: true,
        fields: (method.fields || []).map((field) => ({ ...field, skipable: false })),
        actions: [{ id: 'connect', label: 'Connect', kind: 'primary' }],
      }],
    },
  };
}

export function CodeConnectorsView({
  connections,
  projects,
  onConnectionsChange,
  returnProjectName = '',
  backLabel = 'Back to task',
  onBack,
  onConnected,
}: {
  connections: ConnectorConnection[];
  projects: CodeProject[];
  onConnectionsChange: (connections: ConnectorConnection[]) => void;
  returnProjectName?: string;
  backLabel?: string;
  onBack?: () => void;
  onConnected?: (provider: ProviderId, connection: ConnectorConnection) => Promise<void> | void;
}) {
  const [busyKey, setBusyKey] = useState('');
  const [errorByProvider, setErrorByProvider] = useState<Partial<Record<ProviderId, string>>>({});
  const [disconnecting, setDisconnecting] = useState<ConnectorConnection | null>(null);
  const [credentialSetup, setCredentialSetup] = useState<CredentialSetup | null>(null);
  const [credentialLabel, setCredentialLabel] = useState('');
  const [credentialError, setCredentialError] = useState('');
  const [credentialBusy, setCredentialBusy] = useState(false);
  const cancelledKey = useRef('');

  const providerConnections = useMemo(() => {
    const grouped: Record<ProviderId, ConnectorConnection[]> = { github: [], linear: [] };
    for (const connection of connections) {
      if (connection.engine === 'github' || connection.engine === 'linear') {
        grouped[connection.engine].push(connection);
      }
    }
    return grouped;
  }, [connections]);

  const refresh = async (): Promise<ConnectorConnection[]> => {
    const result = await fetchDatasources();
    const next = Array.isArray(result?.connections) ? result.connections : [];
    onConnectionsChange(next);
    window.dispatchEvent(new CustomEvent('anton:connections-changed'));
    return next;
  };

  const openPersonalCredentialSetup = async (provider: ProviderId, connectionName = '') => {
    const spec = await fetchConnector(provider);
    setCredentialSetup({ ...personalCredentialForm(provider, spec), connectionName });
    setCredentialLabel('');
    setCredentialError('');
  };

  const connect = async (provider: ProviderId, connectionName = '') => {
    const key = `${provider}:${connectionName || 'new'}:oauth`;
    const providerLabel = PROVIDERS.find((item) => item.id === provider)?.label || provider;
    cancelledKey.current = '';
    setBusyKey(key);
    setErrorByProvider((current) => ({ ...current, [provider]: '' }));
    try {
      if (!host.isElectron) {
        await openPersonalCredentialSetup(provider, connectionName);
        return;
      }
      const result = await host.oauthConnect({ engine: provider, name: connectionName });
      if (cancelledKey.current === key) return;
      if (!result?.ok && oauthCredentialsMissing(result)) {
        await openPersonalCredentialSetup(provider, connectionName);
        return;
      }
      if (!result?.ok) throw new Error(result?.reason || `Could not connect ${providerLabel}.`);
      const next = await refresh();
      const connectedName = result.name || connectionName;
      const connected = next.find((item) => item.engine === provider && (!connectedName || item.name === connectedName));
      if (connected) await onConnected?.(provider, connected);
    } catch (reason) {
      if (cancelledKey.current === key || (reason instanceof Error && reason.message === 'cancelled')) return;
      setErrorByProvider((current) => ({
        ...current,
        [provider]: reason instanceof Error ? reason.message : `Could not connect ${providerLabel}.`,
      }));
    } finally {
      setBusyKey('');
    }
  };

  const closeCredentialSetup = () => {
    if (credentialBusy) return;
    setCredentialSetup(null);
    setCredentialLabel('');
    setCredentialError('');
  };

  const savePersonalCredential = async (action: FormAction) => {
    if (!credentialSetup || action.kind !== 'primary') return;
    const { provider, connectionName, method } = credentialSetup;
    setCredentialBusy(true);
    setCredentialError('');
    let saved: { name: string };
    try {
      saved = await validateAndSaveConnector(provider, {
        method,
        name: connectionName,
        replace_existing: Boolean(connectionName),
        values: { ...(action.values || {}), user_label: credentialLabel },
      });
    } catch (reason) {
      setCredentialError(reason instanceof Error ? reason.message : 'Could not validate this credential.');
      setCredentialBusy(false);
      return;
    }

    // The credential is now safely persisted. Unmount the form immediately so
    // its secret-bearing local state cannot survive a later refresh failure.
    setCredentialSetup(null);
    setCredentialLabel('');
    try {
      const next = await refresh();
      const connected = next.find((item) => item.engine === provider && item.name === saved?.name);
      if (connected) {
        await onConnected?.(provider, connected);
      }
    } catch (reason) {
      setErrorByProvider((current) => ({
        ...current,
        [provider]: `Connected, but could not finish updating Code: ${reason instanceof Error ? reason.message : 'try reopening Connectors.'}`,
      }));
    } finally {
      setCredentialBusy(false);
    }
  };

  const disconnect = async () => {
    if (!disconnecting) return;
    const connection = disconnecting;
    const key = `${connection.engine}:${connection.name}:disconnect`;
    setBusyKey(key);
    setErrorByProvider((current) => ({ ...current, [connection.engine as ProviderId]: '' }));
    try {
      const detail = await fetchSavedConnection(connection.engine, connection.name).catch(() => null);
      const accountEmail = typeof detail?.fields?.account_email === 'string' ? detail.fields.account_email : '';
      if (host.isElectron && detail?.method === 'browser_oauth_builtin' && accountEmail) {
        const result = await host.keychainRevoke(connection.engine, connection.name, accountEmail);
        if (!result?.ok) throw new Error(result?.reason || 'Could not disconnect this account.');
      } else {
        await deleteDatasource(connection.engine, connection.name);
      }
      setDisconnecting(null);
      await refresh();
    } catch (reason) {
      setErrorByProvider((current) => ({
        ...current,
        [connection.engine as ProviderId]: reason instanceof Error ? reason.message : 'Could not disconnect this account.',
      }));
    } finally {
      setBusyKey('');
    }
  };

  return (
    <main className="code-connectors-view">
      <header className="code-projects-view__header">
        <div>
          <h1>Connectors</h1>
          <p>Connect developer tools once, then add them to any Code Project.</p>
        </div>
      </header>

      {returnProjectName && (
        <div className="code-connector-return" role="status">
          <span>Accounts you connect here are added to <strong>{returnProjectName}</strong>. Connect as many as you need, then go back.</span>
          {onBack && <Button size="sm" variant="subtle" onClick={onBack}>{backLabel}</Button>}
        </div>
      )}

      <div className="code-connectors-list" aria-label="Code Connectors">
        {PROVIDERS.map((provider) => {
          const accounts = providerConnections[provider.id];
          const providerBusy = busyKey.startsWith(`${provider.id}:`);
          const needsAttention = accounts.some((connection) => connection.status === 'needs_reconnect');
          return (
            <section className="code-connector-provider" key={provider.id} aria-labelledby={`code-connector-${provider.id}`}>
              <div className="code-connector-provider__summary">
                <span className="code-connector-logo" aria-hidden="true">
                  <img src={provider.logo} alt="" />
                </span>
                <span className="code-connector-provider__identity">
                  <h2 id={`code-connector-${provider.id}`}>{provider.label}</h2>
                  <small>{provider.description}</small>
                </span>
                <span className={`code-connector-status${needsAttention ? ' needs-attention' : accounts.length ? ' is-connected' : ''}`}>
                  <span className="code-status-dot" />
                  {needsAttention
                    ? `${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'} · reconnect`
                    : accounts.length ? `${accounts.length} connected` : 'Not connected'}
                </span>
                <Button
                  variant={accounts.length ? 'subtle' : 'primary'}
                  size="sm"
                  disabled={providerBusy}
                  onClick={() => void connect(provider.id)}
                >
                  {providerBusy && busyKey.includes(':new:oauth') ? 'Connecting…' : accounts.length ? 'Add account' : 'Connect'}
                </Button>
              </div>

              {errorByProvider[provider.id] && (
                <div className="code-connector-provider__error">
                  <Alert variant="danger">{errorByProvider[provider.id]}</Alert>
                </div>
              )}

              {providerBusy && busyKey.endsWith(':oauth') && (
                <div className="code-connector-oauth" role="status">
                  <span><strong>Continue in your browser</strong><small>Return here when {provider.label} finishes authorizing.</small></span>
                  <Button size="sm" variant="subtle" onClick={async () => {
                    cancelledKey.current = busyKey;
                    await host.oauthCancel();
                    setBusyKey('');
                  }}>Cancel</Button>
                </div>
              )}

              {accounts.length > 0 && (
                <div className="code-connector-accounts" aria-label={`${provider.label} accounts`}>
                  {accounts.map((connection) => {
                    const needsReconnect = connection.status === 'needs_reconnect';
                    const usage = projectUsage(projects, provider.id, connection.name);
                    const reconnectKey = `${provider.id}:${connection.name}:oauth`;
                    return (
                      <div className="code-connector-account" key={`${connection.engine}:${connection.name}`}>
                        <span className="code-connector-account__rail" aria-hidden="true" />
                        <span className="code-connector-account__identity">
                          <strong>{connectionLabel(connection)}</strong>
                          <small>{usageLabel(usage)}</small>
                        </span>
                        <span className={`code-connector-account__state${needsReconnect ? ' needs-attention' : ''}`}>
                          {needsReconnect ? 'Reconnect' : 'Connected'}
                        </span>
                        {needsReconnect ? (
                          <Button
                            variant="subtle"
                            size="sm"
                            disabled={providerBusy}
                            onClick={() => void connect(provider.id, connection.name)}
                          >
                            {busyKey === reconnectKey ? 'Reconnecting…' : 'Reconnect'}
                          </Button>
                        ) : <span />}
                        <Button
                          icon
                          variant="subtle"
                          size="sm"
                          aria-label={`Disconnect ${connectionLabel(connection)}`}
                          disabled={providerBusy}
                          onClick={() => setDisconnecting(connection)}
                        >
                          {Ico.trash(13)}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <Modal
        open={credentialSetup !== null}
        onClose={closeCredentialSetup}
        closeOnBackdrop={!credentialBusy}
        closeOnEsc={!credentialBusy}
        size="sm"
        labelledBy="code-credential-title"
      >
        <ModalHeader
          id="code-credential-title"
          title={`Connect ${credentialSetup?.provider === 'github' ? 'GitHub' : 'Linear'}`}
          subtitle={credentialSetup?.provider === 'github'
            ? 'Use a personal access token for this local build.'
            : 'Use a personal API key for this local build.'}
          onClose={credentialBusy ? undefined : closeCredentialSetup}
        />
        <ModalBody>
          {credentialError && <Alert variant="danger">{credentialError}</Alert>}
          {credentialSetup && (
            <DataVaultForm
              spec={credentialSetup.formSpec}
              busy={credentialBusy}
              hideHeader
              userLabel={credentialLabel}
              onUserLabelChange={setCredentialLabel}
              onAction={(action: FormAction) => void savePersonalCredential(action)}
            />
          )}
        </ModalBody>
      </Modal>

      <ConfirmModal
        open={disconnecting !== null}
        title={`Disconnect ${disconnecting ? connectionLabel(disconnecting) : 'this account'}?`}
        message="Projects using this account will keep the reference, but Code cannot read or publish through it until you reconnect."
        confirmLabel="Disconnect"
        destructive
        busy={busyKey.endsWith(':disconnect')}
        onClose={() => { if (!busyKey.endsWith(':disconnect')) setDisconnecting(null); }}
        onConfirm={disconnect}
      />
    </main>
  );
}
