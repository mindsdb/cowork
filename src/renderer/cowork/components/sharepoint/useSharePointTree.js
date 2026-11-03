// Lazy folder tree for one SharePoint library: folders load one page at a time
// when expanded, and "Load more" fetches the next page. A response for a
// folder that was collapsed, or for a library no longer shown, is dropped:
// every request carries a token that collapsing or switching library voids.

import { useCallback, useEffect, useRef, useState } from 'react';
import { listSharePointChildren } from '../../api';

export const ROOT = 'root';

const EMPTY_NODE = { items: [], cursor: null, loaded: false, loading: false, error: null, expanded: false };

/**
 * @param {{connection: string|null, site: string|null, driveId: string|null}} library
 * @returns {{
 *   node: (id: string) => typeof EMPTY_NODE,
 *   toggle: (id: string) => void,
 *   loadMore: (id: string) => void,
 *   retry: (id: string) => void,
 * }}
 */
export function useSharePointTree({ connection, site, driveId }) {
  const [nodes, setNodes] = useState({});
  const tokens = useRef(new Map());
  const nextToken = useRef(0);
  const libraryKey = connection && site && driveId ? `${connection}\n${site}\n${driveId}` : null;
  const libraryRef = useRef(libraryKey);
  libraryRef.current = libraryKey;

  const patch = useCallback((id, change) => {
    setNodes((prev) => ({ ...prev, [id]: { ...EMPTY_NODE, ...prev[id], ...change } }));
  }, []);

  const fetchPage = useCallback((id, cursor) => {
    if (!libraryKey) return;
    const token = ++nextToken.current;
    tokens.current.set(id, token);
    const requestedFor = libraryKey;
    patch(id, { loading: true, error: null });
    listSharePointChildren(connection, { site, driveId, itemId: id, cursor })
      .then((page) => {
        if (tokens.current.get(id) !== token || libraryRef.current !== requestedFor) return;
        tokens.current.delete(id);
        setNodes((prev) => {
          const current = { ...EMPTY_NODE, ...prev[id] };
          const items = cursor ? [...current.items, ...(page?.items || [])] : (page?.items || []);
          return { ...prev, [id]: { ...current, items, cursor: page?.cursor || null, loaded: true, loading: false } };
        });
      })
      .catch((err) => {
        if (tokens.current.get(id) !== token || libraryRef.current !== requestedFor) return;
        tokens.current.delete(id);
        patch(id, { loading: false, error: err?.message || 'This folder could not be listed.' });
      });
  }, [connection, site, driveId, libraryKey, patch]);

  useEffect(() => {
    tokens.current = new Map();
    setNodes({});
    if (libraryKey) {
      setNodes({ [ROOT]: { ...EMPTY_NODE, expanded: true } });
      fetchPage(ROOT, null);
    }
  }, [libraryKey, fetchPage]);

  const node = useCallback((id) => ({ ...EMPTY_NODE, ...nodes[id] }), [nodes]);

  const toggle = useCallback((id) => {
    const current = { ...EMPTY_NODE, ...nodes[id] };
    if (current.expanded) {
      // Collapsing voids an in-flight page so it can't land on a closed folder.
      tokens.current.delete(id);
      patch(id, { expanded: false, loading: false });
      return;
    }
    patch(id, { expanded: true });
    if (!current.loaded) fetchPage(id, null);
  }, [nodes, patch, fetchPage]);

  const loadMore = useCallback((id) => {
    const current = { ...EMPTY_NODE, ...nodes[id] };
    if (current.cursor && !current.loading) fetchPage(id, current.cursor);
  }, [nodes, fetchPage]);

  const retry = useCallback((id) => {
    const current = { ...EMPTY_NODE, ...nodes[id] };
    fetchPage(id, current.loaded ? current.cursor : null);
  }, [nodes, fetchPage]);

  return { node, toggle, loadMore, retry };
}
