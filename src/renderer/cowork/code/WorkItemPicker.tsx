import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import type { ProjectConnection, WorkItemSummary } from './api';
import { developerProviderLabel, type DeveloperProvider } from './developerTools';

function updatedLabel(value: string): string {
  if (!value) return '';
  const timestamp = new Date(value).valueOf();
  if (!Number.isFinite(timestamp)) return '';
  const elapsed = Math.max(0, Date.now() - timestamp);
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d` : new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function WorkItemPicker({
  provider,
  onProviderChange,
  providers,
  connections,
  connectionName,
  onConnectionChange,
  query,
  onQueryChange,
  items,
  loading,
  error,
  link,
  onLinkChange,
  onChoose,
  onAddLink,
  onOpenConnectors,
  onClose,
  busy,
}: {
  provider: DeveloperProvider;
  onProviderChange: (provider: DeveloperProvider) => void;
  providers: DeveloperProvider[];
  connections: ProjectConnection[];
  connectionName: string;
  onConnectionChange: (name: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  items: WorkItemSummary[];
  loading: boolean;
  error: string;
  link: string;
  onLinkChange: (link: string) => void;
  onChoose: (item: WorkItemSummary) => void;
  onAddLink: () => void;
  onOpenConnectors: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const providerConnections = connections.filter((item) => item.provider === provider);
  const hasConnections = connections.length > 0;
  return (
    <section className="code-work-picker" aria-label="Start from existing work">
      <header className="code-work-picker__header">
        <div>
          <strong>Start from work</strong>
          <span>{query.trim() ? 'Search issues and pull requests' : 'Recently updated and assigned to you'}</span>
        </div>
        <Button icon size="sm" variant="subtle" aria-label="Close work picker" onClick={onClose}>{Ico.close(13)}</Button>
      </header>

      {hasConnections ? (
        <>
          <div className="code-work-picker__filters">
            <div className="code-work-picker__providers" role="tablist" aria-label="Developer tool">
              {providers.map((item) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={item === provider}
                  key={item}
                  onClick={() => onProviderChange(item)}
                >
                  {developerProviderLabel(item)}
                </button>
              ))}
            </div>
            {providerConnections.length > 1 && (
              <Select
                value={connectionName}
                onValueChange={onConnectionChange}
                options={providerConnections.map((item) => ({ value: item.name, label: item.label || item.name }))}
                variant="unstyled"
                size="sm"
                ariaLabel={`${developerProviderLabel(provider)} account`}
                menuLabel="Account"
              />
            )}
          </div>
          <label className="code-work-picker__search">
            <span aria-hidden="true">{Ico.search(14)}</span>
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={`Search ${developerProviderLabel(provider)}`}
              aria-label={`Search ${developerProviderLabel(provider)} work`}
              disabled={busy}
              autoFocus
            />
          </label>

          <div className="code-work-picker__results" role="listbox" aria-label={`${developerProviderLabel(provider)} work`}>
            {loading && <div className="code-work-picker__message" role="status">Finding work…</div>}
            {!loading && error && <div className="code-work-picker__message is-error" role="alert">{error}</div>}
            {!loading && !error && items.length === 0 && (
              <div className="code-work-picker__message">{query.trim() ? 'No matching work.' : 'No assigned work found.'}</div>
            )}
            {!loading && !error && items.map((item) => (
              <button
                type="button"
                role="option"
                aria-selected="false"
                key={`${item.provider}:${item.url}`}
                onClick={() => onChoose(item)}
                disabled={busy}
              >
                <span className="code-work-picker__kind">{item.kind === 'pull_request' ? 'PR' : item.provider === 'linear' ? 'LIN' : 'ISS'}</span>
                <span className="code-work-picker__identity">
                  <strong>{item.title}</strong>
                  <small>{[item.external_id, item.state, item.assignee].filter(Boolean).join(' · ')}</small>
                </span>
                <time>{updatedLabel(item.updated_at)}</time>
              </button>
            ))}
          </div>

          <div className="code-work-picker__link">
            <input
              value={link}
              onChange={(event) => onLinkChange(event.target.value)}
              placeholder="Or paste an issue or pull-request link"
              aria-label="Issue or pull-request link"
              disabled={busy}
            />
            <Button size="sm" variant="subtle" onClick={onAddLink} disabled={busy || !link.trim()}>Add</Button>
          </div>
        </>
      ) : (
        <div className="code-work-picker__empty">
          <span>Connect GitHub or Linear to start from existing work.</span>
          <Button size="sm" variant="tinted" onClick={onOpenConnectors}>Open Connectors</Button>
        </div>
      )}
    </section>
  );
}
