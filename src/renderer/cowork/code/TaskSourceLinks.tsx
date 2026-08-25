import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ConnectorConnection } from '../api';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import {
  codingApi,
  type CodeProject,
  type ProjectConnection,
  type SourceContext,
  type WorkItemSummary,
} from './api';
import {
  availableDeveloperConnections,
  connectionForSource,
  developerConnections,
  developerProviderLabel,
  parseDeveloperSourceUrl,
  sourceContextLabel,
  sourceContextMeta,
  sourceProviderLabel,
  type DeveloperProvider,
} from './developerTools';
import { WorkItemPicker } from './WorkItemPicker';

const SEARCH_DELAY_MS = 250;

export function TaskSourceLinks({
  project,
  availableConnections,
  value,
  onChange,
  onContextAdded,
  onOpenConnectors,
  onProjectConnectionsChange,
  autoLinkUrl,
  onAutoLinkHandled,
  busy,
}: {
  project: CodeProject | null;
  availableConnections?: ConnectorConnection[];
  value: SourceContext[];
  onChange: (contexts: SourceContext[]) => void;
  onContextAdded: (context: SourceContext) => void;
  onOpenConnectors: () => void;
  onProjectConnectionsChange?: () => Promise<void> | void;
  autoLinkUrl: string;
  onAutoLinkHandled: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<DeveloperProvider>('github');
  const [query, setQuery] = useState('');
  const [link, setLink] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [items, setItems] = useState<WorkItemSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const assignedConnections = useRef(new Set<string>());
  const connections = useMemo(
    () => availableConnections === undefined
      ? developerConnections(project?.connections || [])
      : availableDeveloperConnections(availableConnections),
    [availableConnections, project?.connections],
  );
  const providers = useMemo(() => (
    ['github', 'linear'] as DeveloperProvider[]
  ).filter((candidate) => connections.some((item) => item.provider === candidate)), [connections]);
  const providerConnections = useMemo(
    () => connections.filter((item) => item.provider === provider),
    [connections, provider],
  );

  useEffect(() => {
    assignedConnections.current = new Set(
      (project?.connections || []).map((item) => `${item.provider}:${item.name}`),
    );
  }, [project?.connections, project?.id]);

  useEffect(() => {
    if (!providers.length) return;
    if (!providers.includes(provider)) setProvider(providers[0]);
  }, [provider, providers]);

  useEffect(() => {
    if (!providerConnections.some((item) => item.name === connectionName)) {
      setConnectionName(providerConnections[0]?.name || '');
    }
  }, [connectionName, providerConnections]);

  const ensureProjectConnection = useCallback(async (connection: ProjectConnection) => {
    if (!project) return;
    const key = `${connection.provider}:${connection.name}`;
    if (assignedConnections.current.has(key)) return;
    await codingApi.updateProject(project.id, {
      connections: [...project.connections, connection],
    });
    assignedConnections.current.add(key);
    await onProjectConnectionsChange?.();
  }, [onProjectConnectionsChange, project]);

  const addSource = useCallback(async (sourceUrl: string, preferredConnection = '') => {
    const parsed = parseDeveloperSourceUrl(sourceUrl);
    if (!project || !parsed) {
      setError('Paste a GitHub or Linear issue or pull-request link.');
      setOpen(true);
      return;
    }
    const connection = connectionForSource(connections, parsed, preferredConnection)
      || connectionForSource(connections, parsed, connectionName)
      || connectionForSource(connections, parsed);
    if (!connection) {
      setError(`Choose the ${developerProviderLabel(parsed.provider)} account to use.`);
      setOpen(true);
      return;
    }
    setLoading(true);
    setError('');
    try {
      await ensureProjectConnection(connection);
      const context = await codingApi.readSourceContext(project.id, {
        provider: parsed.provider,
        kind: parsed.kind,
        url: parsed.url,
        connection_name: connection.name,
      });
      onChange([...value.filter((item) => item.url !== context.url), context]);
      onContextAdded(context);
      setLink('');
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load that work item.');
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }, [connectionName, connections, ensureProjectConnection, onChange, onContextAdded, project, value]);

  useEffect(() => {
    if (!open || !project || !connectionName || busy) return undefined;
    const connection = providerConnections.find((item) => item.name === connectionName);
    if (!connection) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const page = await codingApi.searchWorkItems(project.id, {
          provider,
          query: query.trim(),
          connection_name: connection.name,
          limit: 20,
        });
        if (active) setItems(page.items);
      } catch (reason) {
        if (active) {
          setItems([]);
          setError(reason instanceof Error ? reason.message : 'Could not search connected work.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }, SEARCH_DELAY_MS);
    return () => { active = false; window.clearTimeout(timer); };
  }, [busy, connectionName, open, project, provider, providerConnections, query]);

  useEffect(() => {
    if (!autoLinkUrl) return;
    const parsed = parseDeveloperSourceUrl(autoLinkUrl);
    if (parsed) setProvider(parsed.provider);
    setLink(autoLinkUrl);
    setOpen(true);
    onAutoLinkHandled();
    void addSource(autoLinkUrl);
  }, [addSource, autoLinkUrl, onAutoLinkHandled]);

  if (!project) return null;

  return (
    <div className="code-task-sources">
      {value.length > 0 && (
        <div className="code-source-contexts" aria-label="Linked work">
          {value.map((context) => (
            <div className="code-source-card" key={`${context.provider}:${context.url}`}>
              <span className="code-source-card__provider">{sourceProviderLabel(context.provider)}</span>
              <span className="code-source-card__identity">
                <strong>{sourceContextLabel(context)}</strong>
                <span>{context.title}</span>
                {sourceContextMeta(context) && <small>{sourceContextMeta(context)}</small>}
              </span>
              <button type="button" aria-label={`Remove ${sourceContextLabel(context)}`} onClick={() => onChange(value.filter((item) => item.url !== context.url))}>{Ico.close(11)}</button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <WorkItemPicker
          provider={provider}
          onProviderChange={(next) => { setProvider(next); setQuery(''); setItems([]); setError(''); }}
          providers={providers}
          connections={connections}
          connectionName={connectionName}
          onConnectionChange={(name) => { setConnectionName(name); setItems([]); setError(''); }}
          query={query}
          onQueryChange={(next) => { setQuery(next); setError(''); }}
          items={items}
          loading={loading}
          error={error}
          link={link}
          onLinkChange={(next) => { setLink(next); setError(''); }}
          onChoose={(item) => void addSource(item.url, item.connection_name)}
          onAddLink={() => void addSource(link)}
          onOpenConnectors={onOpenConnectors}
          onClose={() => { setOpen(false); setError(''); }}
          busy={busy}
        />
      )}
      <Button size="sm" variant="subtle" className="code-add-source" onClick={() => { setOpen((current) => !current); setError(''); }} disabled={busy}>
        {Ico.link(12)} {value.length ? 'Add another issue or PR' : 'Add issue or PR'}
      </Button>
    </div>
  );
}
