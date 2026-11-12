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
import i18n, { useTranslation } from '../../lib/i18n';
import { ConfirmModal } from '../components/ConfirmModal';
import { DataVaultForm } from '../components/datavault/DataVaultForm';
import Ico from '../components/Icons';
import OverflowMenu from '../components/OverflowMenu';
import { ListGroup, ListItem, ListNotice, PageHeader, StatusDot } from '../components/collection';
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
  descriptionKey: string;
  logo: string;
}> = [
  {
    id: 'github',
    label: 'GitHub',
    descriptionKey: 'connectors.providers.github',
    logo: 'logos/github.svg',
  },
  {
    id: 'linear',
    label: 'Linear',
    descriptionKey: 'connectors.providers.linear',
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
  if (count === 0) return i18n.t('connectors.usage.none', { ns: 'code' });
  return i18n.t('connectors.usage.used', { ns: 'code', count });
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
  if (!method) throw new Error(i18n.t('connectors.errors.loadOptions', { ns: 'code', provider: provider === 'github' ? 'GitHub' : 'Linear' }));
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
        actions: [{ id: 'connect', label: i18n.t('connectors.connect', { ns: 'code' }), kind: 'primary' }],
      }],
    },
  };
}

export function CodeConnectorsView({
  connections,
  projects,
  onConnectionsChange,
  returnProjectName = '',
  backLabel,
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
  const { t } = useTranslation('code');
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
      if (!result?.ok) throw new Error(result?.reason || t('connectors.errors.connect', { provider: providerLabel }));
      const next = await refresh();
      const connectedName = result.name || connectionName;
      const connected = next.find((item) => item.engine === provider && (!connectedName || item.name === connectedName));
      if (connected) await onConnected?.(provider, connected);
    } catch (reason) {
      if (cancelledKey.current === key || (reason instanceof Error && reason.message === 'cancelled')) return;
      setErrorByProvider((current) => ({
        ...current,
        [provider]: reason instanceof Error ? reason.message : t('connectors.errors.connect', { provider: providerLabel }),
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
      setCredentialError(reason instanceof Error ? reason.message : t('connectors.errors.validate'));
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
        [provider]: t('connectors.errors.postConnect', { reason: reason instanceof Error ? reason.message : t('connectors.errors.postConnectFallback') }),
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
        if (!result?.ok) throw new Error(result?.reason || t('connectors.errors.disconnect'));
      } else {
        await deleteDatasource(connection.engine, connection.name);
      }
      setDisconnecting(null);
      await refresh();
    } catch (reason) {
      setErrorByProvider((current) => ({
        ...current,
        [connection.engine as ProviderId]: reason instanceof Error ? reason.message : t('connectors.errors.disconnect'),
      }));
    } finally {
      setBusyKey('');
    }
  };

  return (
    <main className="code-connectors-view">
      <PageHeader
        title={t('connectors.title')}
        subtitle={t('connectors.subtitle')}
      />

      {(returnProjectName || onBack) && (
        <div className="code-connector-return" role="status">
          <span>{returnProjectName
            ? <>{t('connectors.returnProject.before')} <strong>{returnProjectName}</strong>{t('connectors.returnProject.after')}</>
            : t('connectors.returnTask')}</span>
          {onBack && <Button size="sm" variant="subtle" onClick={onBack}>{backLabel ?? t('connectors.backToTask')}</Button>}
        </div>
      )}

      <div className="mx-8 grid gap-4" aria-label={t('connectors.ariaLabel')}>
        {PROVIDERS.map((provider) => {
          const accounts = providerConnections[provider.id];
          const providerBusy = busyKey.startsWith(`${provider.id}:`);
          const needsAttention = accounts.some((connection) => connection.status === 'needs_reconnect');
          return (
            <ListGroup key={provider.id} aria-labelledby={`code-connector-${provider.id}`}>
              <ListItem
                leading={<span className="inline-grid size-6 place-items-center overflow-hidden rounded-md border border-solid border-line bg-white" aria-hidden="true">
                  <img src={provider.logo} alt="" className="block size-3.5" />
                </span>}
                title={<span role="heading" aria-level={2} id={`code-connector-${provider.id}`}>{provider.label}</span>}
                description={t(provider.descriptionKey)}
                meta={<>
                  <StatusDot tone={needsAttention ? 'warning' : accounts.length ? 'success' : 'muted'}>
                    {needsAttention
                      ? t('connectors.status.reconnect', { count: accounts.length })
                      : accounts.length ? t('connectors.status.connectedCount', { count: accounts.length }) : t('connectors.status.notConnected')}
                  </StatusDot>
                  <Button
                    variant={accounts.length ? 'subtle' : 'primary'}
                    size="sm"
                    disabled={providerBusy}
                    onClick={() => void connect(provider.id)}
                  >
                    {providerBusy && busyKey.includes(':new:oauth') ? t('connectors.connecting') : accounts.length ? t('connectors.addAccount') : t('connectors.connect')}
                  </Button>
                </>}
              />

              {errorByProvider[provider.id] && (
                <ListNotice><Alert variant="danger">{errorByProvider[provider.id]}</Alert></ListNotice>
              )}

              {providerBusy && busyKey.endsWith(':oauth') && (
                <ListNotice className="flex items-center justify-between gap-3 bg-accent-bg">
                  <span role="status" className="grid min-w-0 gap-0.5 pl-9">
                    <strong className="text-xs font-semibold text-ink-2">{t('connectors.browser.title')}</strong>
                    <small className="text-2xs text-ink-4">{t('connectors.browser.hint', { provider: provider.label })}</small>
                  </span>
                  <Button size="sm" variant="subtle" onClick={async () => {
                    cancelledKey.current = busyKey;
                    await host.oauthCancel();
                    setBusyKey('');
                  }}>{t('connectors.cancel')}</Button>
                </ListNotice>
              )}

              {accounts.map((connection) => {
                const needsReconnect = connection.status === 'needs_reconnect';
                const label = connectionLabel(connection);
                const reconnectKey = `${provider.id}:${connection.name}:oauth`;
                return (
                  <ListItem
                    key={`${connection.engine}:${connection.name}`}
                    leading={<StatusDot tone={needsReconnect ? 'warning' : 'success'} />}
                    title={label}
                    description={usageLabel(projectUsage(projects, provider.id, connection.name))}
                    // The '…' stays in the meta's flow (not ListItem's hover
                    // overlay) so it never covers the visible Reconnect button.
                    meta={<>
                      {needsReconnect ? <>
                        <StatusDot tone="warning">{t('connectors.status.reconnectNeeded')}</StatusDot>
                        <Button
                          variant="subtle"
                          size="sm"
                          disabled={providerBusy}
                          onClick={() => void connect(provider.id, connection.name)}
                        >
                          {busyKey === reconnectKey ? t('connectors.reconnecting') : t('connectors.reconnect')}
                        </Button>
                      </> : <StatusDot tone="success">{t('connectors.status.connected')}</StatusDot>}
                      <OverflowMenu
                        label={t('skills.view.moreActions', { name: label })}
                        icon={Ico.more(14)}
                        disabled={providerBusy}
                        size="sm"
                        items={[{ id: 'disconnect', label: t('connectors.disconnect.action'), icon: Ico.trash(14), danger: true, onClick: () => setDisconnecting(connection) }]}
                      />
                    </>}
                  />
                );
              })}
            </ListGroup>
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
          title={t('connectors.credential.title', { provider: credentialSetup?.provider === 'github' ? 'GitHub' : 'Linear' })}
          subtitle={credentialSetup?.provider === 'github'
            ? t('connectors.credential.githubSubtitle')
            : t('connectors.credential.linearSubtitle')}
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
        title={disconnecting ? t('connectors.disconnect.title', { name: connectionLabel(disconnecting) }) : t('connectors.disconnect.titleFallback')}
        message={t('connectors.disconnect.message')}
        confirmLabel={t('connectors.disconnect.action')}
        destructive
        busy={busyKey.endsWith(':disconnect')}
        onClose={() => { if (!busyKey.endsWith(':disconnect')) setDisconnecting(null); }}
        onConfirm={disconnect}
      />
    </main>
  );
}
