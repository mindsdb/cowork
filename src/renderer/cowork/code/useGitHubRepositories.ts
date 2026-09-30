import { useEffect, useState } from 'react';
import { codingApi, type GitHubRepository } from './api';

/** Mounted per connection by RepositoryPicker: no account data survives a switch. */
export function useGitHubRepositories(connectionName: string, searching: boolean) {
  const [items, setItems] = useState<GitHubRepository[]>([]);
  const [page, setPage] = useState(1);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    codingApi.githubRepositories(connectionName, page).then((result) => {
      if (!active) return;
      setItems((previous) => [...new Map([...previous, ...result.items].map((item) => [item.clone_url, item])).values()]);
      setNextPage(result.next_page);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load repositories. Try again.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [connectionName, page, retry]);

  // GitHub's authenticated repository list has no name-search parameter.
  // Search progressively through its pages, rather than silently searching
  // only the first 100 or returning unrelated public repositories.
  useEffect(() => {
    if (!searching || loading || error || nextPage === null || nextPage <= page) return;
    const timer = setTimeout(() => setPage(nextPage), 250);
    return () => clearTimeout(timer);
  }, [searching, loading, error, nextPage, page]);

  return {
    items, loading, error, hasMore: nextPage !== null,
    loadMore: () => { if (nextPage !== null && !loading) setPage(nextPage); },
    retry: () => setRetry((value) => value + 1),
  };
}
