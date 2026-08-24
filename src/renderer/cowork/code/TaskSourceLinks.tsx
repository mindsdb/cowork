import { useCallback, useEffect, useMemo, useState } from 'react';

import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import {
  codingApi,
  type CodeProject,
  type SourceContext,
} from './api';
import {
  connectionForSource,
  developerConnections,
  developerProviderLabel,
  parseDeveloperSourceUrl,
  sourceContextLabel,
  sourceContextMeta,
  sourceProviderLabel,
} from './developerTools';

export function TaskSourceLinks({
  project,
  value,
  onChange,
  onContextAdded,
  onOpenConnectors,
  autoLinkUrl,
  onAutoLinkHandled,
  busy,
}: {
  project: CodeProject | null;
  value: SourceContext[];
  onChange: (contexts: SourceContext[]) => void;
  onContextAdded: (context: SourceContext) => void;
  onOpenConnectors: () => void;
  autoLinkUrl: string;
  onAutoLinkHandled: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const connections = useMemo(() => developerConnections(project?.connections || []), [project?.connections]);
  const target = useMemo(() => parseDeveloperSourceUrl(url), [url]);
  const matchingConnections = useMemo(
    () => target
      ? connections.filter((connection) => connection.provider === target.provider)
      : connections,
    [connections, target],
  );
  const selectedConnection = target
    ? connectionForSource(connections, target, connectionName)
    : null;

  useEffect(() => {
    if (!target) return;
    const inferred = connectionForSource(connections, target);
    if (inferred) setConnectionName(inferred.name);
    else if (!matchingConnections.some((connection) => connection.name === connectionName)) setConnectionName('');
  }, [connectionName, connections, matchingConnections, target]);

  const addSource = useCallback(async (sourceUrl: string) => {
    const parsed = parseDeveloperSourceUrl(sourceUrl);
    if (!project || !parsed) {
      setError('Paste a GitHub or Linear issue or pull-request link.');
      setOpen(true);
      return;
    }
    const connection = connectionForSource(project.connections, parsed, connectionName)
      || connectionForSource(project.connections, parsed);
    if (!connection) {
      setError(`Choose the ${developerProviderLabel(parsed.provider)} account this project should use.`);
      setOpen(true);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const context = await codingApi.readSourceContext(project.id, {
        provider: parsed.provider,
        kind: parsed.kind,
        url: parsed.url,
        connection_name: connection.name,
      });
      onChange([...value.filter((item) => item.url !== context.url), context]);
      onContextAdded(context);
      setUrl('');
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load that work item.');
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }, [connectionName, onChange, onContextAdded, project, value]);

  useEffect(() => {
    if (!autoLinkUrl) return;
    setUrl(autoLinkUrl);
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
        <div className="code-source-linker">
          {connections.length ? (
            <>
              <input
                value={url}
                onChange={(event) => { setUrl(event.target.value); setError(''); }}
                placeholder="Paste a GitHub or Linear issue link"
                aria-label="Issue or pull-request link"
                disabled={loading || busy}
                autoFocus
              />
              {target && matchingConnections.length > 1 && (
                <Select
                  value={connectionName}
                  onValueChange={setConnectionName}
                  options={matchingConnections.map((connection) => ({ value: connection.name, label: connection.label || connection.name }))}
                  size="sm"
                  ariaLabel={`${developerProviderLabel(target.provider)} account`}
                  disabled={loading || busy}
                />
              )}
              <Button size="sm" disabled={loading || busy || !target || !selectedConnection} onClick={() => void addSource(url)}>
                {loading ? 'Adding…' : 'Add'}
              </Button>
            </>
          ) : (
            <div className="code-source-linker__empty">
              <span>Connect GitHub or Linear to start from an issue or pull request.</span>
              <Button size="sm" variant="subtle" onClick={onOpenConnectors}>Open Connectors</Button>
            </div>
          )}
          <button type="button" aria-label="Close issue linker" onClick={() => { setOpen(false); setError(''); }}>{Ico.close(12)}</button>
        </div>
      )}
      {error && <div className="code-source-linker__error" role="alert">{error}</div>}
      <Button size="sm" variant="subtle" className="code-add-source" onClick={() => { setOpen((current) => !current); setError(''); }} disabled={busy}>
        {Ico.link(12)} {value.length ? 'Add another issue or PR' : 'Add issue or PR'}
      </Button>
    </div>
  );
}
