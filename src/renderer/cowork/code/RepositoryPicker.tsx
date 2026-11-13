import { useState } from 'react';
import type { ConnectorConnection } from '../api';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import type { GitHubRepository } from './api';
import { useGitHubRepositories } from './useGitHubRepositories';
import { useTranslation } from '../../lib/i18n';
import './repository-picker.css';

export function repositoryKey(value: string): string {
  return value.trim().replace(/^git@([^:]+):/, 'https://$1/').replace(/^ssh:\/\/git@/, 'https://')
    .replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

function RepositoryResults({ connectionName, query, existing, disabled, onChoose, onOpenConnectors }: {
  connectionName: string;
  query: string;
  existing: string[];
  disabled: boolean;
  onChoose: (repository: GitHubRepository) => void;
  onOpenConnectors: () => void;
}) {
  const { t } = useTranslation('code');
  const term = query.trim().toLowerCase();
  const page = useGitHubRepositories(connectionName, !!term);
  const matching = page.items.filter((item) => item.full_name.toLowerCase().includes(term));
  const searching = page.loading || (!!term && page.hasMore && !page.error);
  return <>
    <ul className="code-repository-picker__results" aria-label={t('repositoryPicker.resultsAriaLabel')} aria-busy={searching}>
      {matching.map((repository) => {
        const added = existing.includes(repositoryKey(repository.clone_url));
        return <li key={repository.clone_url}>
          <button type="button" disabled={disabled || added} onClick={() => onChoose(repository)}>
            <span aria-hidden="true">{Ico.code(14)}</span>
            <span className="code-repository-picker__identity">
              <strong>{repository.full_name}</strong>
              <small>{repository.private ? t('repositoryPicker.private') : t('repositoryPicker.public')}{repository.archived ? t('repositoryPicker.archivedSuffix') : ''}</small>
            </span>
            <span className="code-repository-picker__action">{added ? t('repositoryPicker.added') : t('repositoryPicker.add')}</span>
          </button>
        </li>;
      })}
    </ul>
    {searching && <p className="code-repository-picker__message" role="status">{page.items.length ? t('repositoryPicker.searchingMore') : t('repositoryPicker.loading')}</p>}
    {!searching && !page.error && !matching.length && <p className="code-repository-picker__message">{term ? t('repositoryPicker.noMatches') : t('repositoryPicker.noRepositories')}</p>}
    {page.error && <div className="code-repository-picker__message">
      <p role="alert">{page.error}</p>
      <Button size="sm" variant="subtle" onClick={page.retry} disabled={disabled}>{t('repositoryPicker.tryAgain')}</Button>
      <Button size="sm" variant="subtle" onClick={onOpenConnectors} disabled={disabled}>{t('repositoryPicker.manageConnection')}</Button>
    </div>}
    {!term && page.hasMore && !page.loading && !page.error && <Button size="sm" variant="subtle" onClick={page.loadMore} disabled={disabled}>{t('repositoryPicker.loadMore')}</Button>}
  </>;
}

export function RepositoryPicker({ connections, existingUrls, disabled = false, onChoose, onAddUrl, onOpenConnectors, onClose }: {
  connections: ConnectorConnection[];
  existingUrls: string[];
  disabled?: boolean;
  onChoose: (repository: GitHubRepository) => void;
  onAddUrl: (url: string) => void;
  onOpenConnectors: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('code');
  const accounts = connections.filter((item) => item.engine === 'github');
  const [chosenAccount, setChosenAccount] = useState('');
  const account = accounts.find((item) => item.name === chosenAccount) || accounts[0];
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [urlOpen, setUrlOpen] = useState(false);
  const unavailable = account?.status === 'needs_reconnect' || account?.status === 'missing';
  return <section className="code-repository-picker" aria-label={t('repositoryPicker.ariaLabel')} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }}>
    <header className="code-repository-picker__header">
      <strong><img src="logos/github.svg" alt="" /> {t('repositoryPicker.title')}</strong>
      <Button icon size="sm" variant="subtle" aria-label={t('repositoryPicker.close')} disabled={disabled} onClick={onClose}>{Ico.close(14)}</Button>
    </header>
    {accounts.length > 1 && <Select value={account.name} onValueChange={(value) => { setChosenAccount(value); setQuery(''); }}
      options={accounts.map((item) => ({ value: item.name, label: item.user_label || item.display_name || item.name }))}
      ariaLabel={t('repositoryPicker.accountAriaLabel')} menuLabel={t('repositoryPicker.accountMenuLabel')} size="sm" disabled={disabled} />}
    {!account || unavailable ? <div className="code-repository-picker__message">
      <p>{unavailable ? t('repositoryPicker.reconnectHint') : t('repositoryPicker.connectHint')}</p>
      <Button size="sm" variant="tinted" onClick={onOpenConnectors} disabled={disabled}>{unavailable ? t('repositoryPicker.reconnect') : t('repositoryPicker.connect')}</Button>
    </div> : <>
      <Input value={query} onChange={setQuery} leading={Ico.search(14)} placeholder={t('repositoryPicker.searchPlaceholder')} aria-label={t('repositoryPicker.searchAriaLabel')} disabled={disabled} autoFocus />
      <RepositoryResults key={account.name} connectionName={account.name} query={query} existing={existingUrls.map(repositoryKey)}
        disabled={disabled} onChoose={onChoose} onOpenConnectors={onOpenConnectors} />
      <p className="code-repository-picker__hint">{t('repositoryPicker.missingHint')} <button type="button" onClick={onOpenConnectors} disabled={disabled}>{t('repositoryPicker.manageAccess')}</button></p>
    </>}
    <div className="code-repository-picker__url">
      <Button size="sm" variant="subtle" onClick={() => setUrlOpen((value) => !value)} disabled={disabled} aria-expanded={urlOpen}>
        {Ico.link(14)} {t('repositoryPicker.pasteUrl')}
      </Button>
      {urlOpen && <div className="code-resource-url-row">
        <Input value={url} onChange={setUrl} placeholder="https://github.com/org/repository.git" aria-label={t('repositoryPicker.urlAriaLabel')} disabled={disabled} autoFocus
          onKeyDown={(event) => { if (event.key === 'Enter' && url.trim()) { event.preventDefault(); onAddUrl(url); } }} />
        <Button size="sm" variant="primary" disabled={disabled || !url.trim()} onClick={() => onAddUrl(url)}>{t('repositoryPicker.add')}</Button>
      </div>}
    </div>
  </section>;
}
