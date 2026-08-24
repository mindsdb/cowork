import { useMemo, useState } from 'react';

import { deleteDatasource, fetchDatasources, fetchSavedConnection, type ConnectorConnection } from '../api';
import { ConfirmModal } from '../components/ConfirmModal';
import Ico from '../components/Icons';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import { host } from '../../platform/host';
import type { CodeProject } from './api';

type ProviderId = 'github' | 'linear';

const PROVIDERS: Array<{
  id: ProviderId;
  label: string;
  description: string;
  logo: string;
}> = [
  {
    id: 'github',
    label: 'GitHub',
    description: 'Repositories, issues, pull requests, reviews, and CI.',
    logo: 'logos/github.svg',
  },
  {
    id: 'linear',
    label: 'Linear',
    description: 'Issues, projects, cycles, and task updates.',
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

export function CodeConnectorsView({
  connections,
  projects,
  onConnectionsChange,
}: {
  connections: ConnectorConnection[];
  projects: CodeProject[];
  onConnectionsChange: (connections: ConnectorConnection[]) => void;
}) {
  const [busyKey, setBusyKey] = useState('');
  const [errorByProvider, setErrorByProvider] = useState<Partial<Record<ProviderId, string>>>({});
  const [disconnecting, setDisconnecting] = useState<ConnectorConnection | null>(null);

  const providerConnections = useMemo(() => {
    const grouped: Record<ProviderId, ConnectorConnection[]> = { github: [], linear: [] };
    for (const connection of connections) {
      if (connection.engine === 'github' || connection.engine === 'linear') {
        grouped[connection.engine].push(connection);
      }
    }
    return grouped;
  }, [connections]);

  const refresh = async () => {
    const result = await fetchDatasources();
    const next = Array.isArray(result?.connections) ? result.connections : [];
    onConnectionsChange(next);
    window.dispatchEvent(new CustomEvent('anton:connections-changed'));
  };

  const connect = async (provider: ProviderId, connectionName = '') => {
    const key = `${provider}:${connectionName || 'new'}`;
    const providerLabel = PROVIDERS.find((item) => item.id === provider)?.label || provider;
    setBusyKey(key);
    setErrorByProvider((current) => ({ ...current, [provider]: '' }));
    try {
      const result = await host.oauthConnect({ engine: provider, name: connectionName });
      if (!result?.ok) throw new Error(result?.reason || `Could not connect ${providerLabel}.`);
      await refresh();
    } catch (reason) {
      setErrorByProvider((current) => ({
        ...current,
        [provider]: reason instanceof Error ? reason.message : `Could not connect ${providerLabel}.`,
      }));
    } finally {
      setBusyKey('');
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
                  {providerBusy && busyKey.endsWith(':new') ? 'Connecting…' : accounts.length ? 'Add account' : 'Connect'}
                </Button>
              </div>

              {errorByProvider[provider.id] && (
                <div className="code-connector-provider__error">
                  <Alert variant="danger">{errorByProvider[provider.id]}</Alert>
                </div>
              )}

              {accounts.length > 0 && (
                <div className="code-connector-accounts" aria-label={`${provider.label} accounts`}>
                  {accounts.map((connection) => {
                    const needsReconnect = connection.status === 'needs_reconnect';
                    const usage = projectUsage(projects, provider.id, connection.name);
                    const reconnectKey = `${provider.id}:${connection.name}`;
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
