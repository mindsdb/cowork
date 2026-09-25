import { useState } from 'react';
import type { ConnectorConnection } from '../api';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import type { GitHubRepository } from './api';
import { useGitHubRepositories } from './useGitHubRepositories';
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
  const term = query.trim().toLowerCase();
  const page = useGitHubRepositories(connectionName, !!term);
  const matching = page.items.filter((item) => item.full_name.toLowerCase().includes(term));
  const searching = page.loading || (!!term && page.hasMore && !page.error);
  return <>
    <ul className="code-repository-picker__results" aria-label="GitHub repositories" aria-busy={searching}>
      {matching.map((repository) => {
        const added = existing.includes(repositoryKey(repository.clone_url));
        return <li key={repository.clone_url}>
          <button type="button" disabled={disabled || added} onClick={() => onChoose(repository)}>
            <span aria-hidden="true">{Ico.code(15)}</span>
            <span className="code-repository-picker__identity">
              <strong>{repository.full_name}</strong>
              <small>{repository.private ? 'Private' : 'Public'}{repository.archived ? ' · Archived' : ''}</small>
            </span>
            <span className="code-repository-picker__action">{added ? 'Added' : 'Add'}</span>
          </button>
        </li>;
      })}
    </ul>
    {searching && <p className="code-repository-picker__message" role="status">{page.items.length ? 'Searching more repositories…' : 'Loading repositories…'}</p>}
    {!searching && !page.error && !matching.length && <p className="code-repository-picker__message">{term ? 'No matching repositories.' : 'No repositories available to this connection.'}</p>}
    {page.error && <div className="code-repository-picker__message">
      <p role="alert">{page.error}</p>
      <Button size="sm" variant="subtle" onClick={page.retry} disabled={disabled}>Try again</Button>
      <Button size="sm" variant="subtle" onClick={onOpenConnectors} disabled={disabled}>Manage connection</Button>
    </div>}
    {!term && page.hasMore && !page.loading && !page.error && <Button size="sm" variant="subtle" onClick={page.loadMore} disabled={disabled}>Load more repositories</Button>}
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
  const accounts = connections.filter((item) => item.engine === 'github');
  const [chosenAccount, setChosenAccount] = useState('');
  const account = accounts.find((item) => item.name === chosenAccount) || accounts[0];
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [urlOpen, setUrlOpen] = useState(!accounts.length);
  const unavailable = account?.status === 'needs_reconnect' || account?.status === 'missing';
  return <section className="code-repository-picker" aria-label="Add Git repository" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }}>
    <header className="code-repository-picker__header">
      <strong><img src="logos/github.svg" alt="" /> GitHub repositories</strong>
      <Button icon size="sm" variant="subtle" aria-label="Close repository picker" disabled={disabled} onClick={onClose}>{Ico.close(13)}</Button>
    </header>
    {accounts.length > 1 && <Select value={account.name} onValueChange={(value) => { setChosenAccount(value); setQuery(''); }}
      options={accounts.map((item) => ({ value: item.name, label: item.user_label || item.display_name || item.name }))}
      ariaLabel="GitHub account" menuLabel="Account" size="sm" disabled={disabled} />}
    {!account || unavailable ? <div className="code-repository-picker__message">
      <p>{unavailable ? 'Reconnect GitHub to browse your repositories.' : 'Choose from your repositories by connecting GitHub.'}</p>
      <Button size="sm" variant="tinted" onClick={onOpenConnectors} disabled={disabled}>{unavailable ? 'Reconnect GitHub' : 'Connect GitHub'}</Button>
    </div> : <>
      <Input value={query} onChange={setQuery} leading={Ico.search(14)} placeholder="Search repositories…" aria-label="Search repositories" disabled={disabled} autoFocus />
      <RepositoryResults key={account.name} connectionName={account.name} query={query} existing={existingUrls.map(repositoryKey)}
        disabled={disabled} onChoose={onChoose} onOpenConnectors={onOpenConnectors} />
      <p className="code-repository-picker__hint">Missing a repository? This connection may need access to it. <button type="button" onClick={onOpenConnectors} disabled={disabled}>Manage access</button></p>
    </>}
    <div className="code-repository-picker__url">
      <Button size="sm" variant="subtle" onClick={() => setUrlOpen((value) => !value)} disabled={disabled} aria-expanded={urlOpen}>
        {Ico.link(13)} Paste repository URL
      </Button>
      {urlOpen && <div className="code-resource-url-row">
        <Input value={url} onChange={setUrl} placeholder="https://github.com/org/repository.git" aria-label="Git repository URL" disabled={disabled} autoFocus
          onKeyDown={(event) => { if (event.key === 'Enter' && url.trim()) { event.preventDefault(); onAddUrl(url); } }} />
        <Button size="sm" variant="primary" disabled={disabled || !url.trim()} onClick={() => onAddUrl(url)}>Add</Button>
      </div>}
    </div>
  </section>;
}
