import Ico from '../components/Icons';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import type { ProjectConnection, WorkItemSummary } from './api';
import { developerProviderLabel, type DeveloperProvider } from './developerTools';
import i18n, { currentLocale, useTranslation } from '../../lib/i18n';

function updatedLabel(value: string): string {
  if (!value) return '';
  const timestamp = new Date(value).valueOf();
  if (!Number.isFinite(timestamp)) return '';
  const elapsed = Math.max(0, Date.now() - timestamp);
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return i18n.t('workItemPicker.justNow', { ns: 'code' });
  if (hours < 24) return i18n.t('workItemPicker.hours', { ns: 'code', count: hours });
  const days = Math.floor(hours / 24);
  return days < 30
    ? i18n.t('workItemPicker.days', { ns: 'code', count: days })
    : new Date(value).toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric' });
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
  adding,
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
  adding: boolean;
  error: string;
  link: string;
  onLinkChange: (link: string) => void;
  onChoose: (item: WorkItemSummary) => void;
  onAddLink: () => void;
  onOpenConnectors: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation('code');
  const providerName = developerProviderLabel(provider);
  const providerConnections = connections.filter((item) => item.provider === provider);
  const hasConnections = connections.length > 0;
  return (
    <section className="code-work-picker" aria-label={t('workItemPicker.ariaLabel')}>
      <header className="code-work-picker__header">
        <div>
          <strong>{t('workItemPicker.title')}</strong>
          <span>{query.trim() ? t('workItemPicker.searchSubtitle') : t('workItemPicker.recentSubtitle')}</span>
        </div>
        <Button icon size="sm" variant="subtle" aria-label={t('workItemPicker.close')} onClick={onClose} disabled={busy}>{Ico.close(14)}</Button>
      </header>

      {hasConnections ? (
        <>
          <div className="code-work-picker__filters">
            <ToggleGroup
              size="sm"
              aria-label={t('workItemPicker.providerAriaLabel')}
              disabled={busy}
              value={provider}
              onValueChange={(value) => onProviderChange(value as DeveloperProvider)}
              options={providers.map((item) => ({ value: item, label: developerProviderLabel(item) }))}
            />
            {providerConnections.length > 1 && (
              <Select
                value={connectionName}
                onValueChange={onConnectionChange}
                options={providerConnections.map((item) => ({ value: item.name, label: item.label || item.name }))}
                variant="unstyled"
                size="sm"
                ariaLabel={t('workItemPicker.accountAriaLabel', { provider: providerName })}
                disabled={busy}
                menuLabel={t('workItemPicker.accountMenuLabel')}
              />
            )}
          </div>
          <Input
            value={query}
            onChange={onQueryChange}
            size="sm"
            leading={Ico.search(14)}
            wrapperClassName="code-work-picker__search"
            placeholder={t('workItemPicker.searchPlaceholder', { provider: providerName })}
            aria-label={t('workItemPicker.searchAriaLabel', { provider: providerName })}
            disabled={busy}
            autoFocus
          />

          <div className="code-work-picker__results" role="listbox" aria-label={t('workItemPicker.resultsAriaLabel', { provider: providerName })}>
            {loading && <div className="code-work-picker__message" role="status">{t('workItemPicker.finding')}</div>}
            {!loading && error && <div className="code-work-picker__message is-error" role="alert">{error}</div>}
            {!loading && !error && items.length === 0 && (
              <div className="code-work-picker__message">{query.trim() ? t('workItemPicker.noMatches') : t('workItemPicker.noAssigned')}</div>
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
                <Badge size="xs" className="code-work-picker__kind">{item.kind === 'pull_request' ? 'PR' : item.provider === 'linear' ? 'LIN' : 'ISS'}</Badge>
                <span className="code-work-picker__identity">
                  <strong>{item.title}</strong>
                  <small>{[item.external_id, item.state, item.assignee].filter(Boolean).join(' · ')}</small>
                </span>
                <time>{updatedLabel(item.updated_at)}</time>
              </button>
            ))}
          </div>

          <div className="code-work-picker__link">
            <Input
              value={link}
              onChange={onLinkChange}
              size="sm"
              placeholder={t('workItemPicker.linkPlaceholder')}
              aria-label={t('workItemPicker.linkAriaLabel')}
              disabled={busy}
            />
            <Button size="sm" variant="subtle" onClick={onAddLink} disabled={busy || !link.trim()}>{adding ? t('workItemPicker.adding') : t('workItemPicker.add')}</Button>
          </div>
        </>
      ) : (
        <div className="code-work-picker__empty">
          <span>{t('workItemPicker.connectHint')}</span>
          <Button size="sm" variant="tinted" onClick={onOpenConnectors}>{t('workItemPicker.openConnectors')}</Button>
        </div>
      )}
    </section>
  );
}
