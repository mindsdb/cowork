import { useEffect, useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal';
import { Alert, Button, Input, Spinner } from './ui';
import Ico from './Icons';
import { searchNotionPages } from '../api';

const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

const pageKey = (p) => `${p.connectionName}:${p.id}`;

// The modal stays mounted while closed, when App passes no connections. A
// `= []` default would be a new array every render, and the search effect,
// which depends on it, would re-run and re-render forever.
const NO_CONNECTIONS = [];

// Searches every connected Notion workspace at once and lets the user pick
// pages. Notion's search needs a query, so the list starts empty.
export default function NotionPagePickerModal({ open, connections = NO_CONNECTIONS, onClose, onConfirm }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setSelected(new Map());
    setError('');
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < MIN_QUERY_LENGTH) {
      setResults((prev) => (prev.length ? [] : prev));
      setLoading(false);
      setError('');
      return undefined;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      const settled = await Promise.allSettled(connections.map(async (c) => {
        const pages = await searchNotionPages(c.name, q, { signal: ctrl.signal });
        return pages.map((p) => ({ ...p, connectionName: c.name, workspace: c.display_name || c.name }));
      }));
      if (ctrl.signal.aborted) return;
      const found = settled.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
      const failed = settled.filter((r) => r.status === 'rejected');
      setResults(found);
      // One unreachable workspace shouldn't hide another's results.
      setError(found.length === 0 && failed.length
        ? (failed[0].reason?.message || 'Could not search Notion.')
        : '');
      setLoading(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, query, connections]);

  const toggle = (page) => setSelected((prev) => {
    const next = new Map(prev);
    if (next.has(pageKey(page))) next.delete(pageKey(page));
    else next.set(pageKey(page), page);
    return next;
  });

  const showWorkspace = connections.length > 1;
  const hasQuery = query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <Modal open={open} onClose={onClose} size="md" labelledBy="notion-page-picker-title">
      <ModalHeader
        id="notion-page-picker-title"
        title="Add pages from Notion"
        subtitle="Search your Notion and pick pages for this message."
        onClose={onClose}
      />
      <ModalBody>
        <Input
          value={query}
          onChange={setQuery}
          placeholder="Search Notion pages…"
          aria-label="Search Notion pages"
          autoFocus
          leading={Ico.search(14)}
          trailing={loading ? <Spinner /> : null}
        />
        {error && <div style={{ marginTop: 10 }}><Alert variant="danger">{error}</Alert></div>}
        <div role="listbox" aria-multiselectable="true" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12, minHeight: 120 }}>
          {!hasQuery && <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Type at least {MIN_QUERY_LENGTH} characters to search.</p>}
          {hasQuery && !loading && !error && results.length === 0 && (
            <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No pages found.</p>
          )}
          {results.map((page) => {
            const checked = selected.has(pageKey(page));
            return (
              <button
                key={pageKey(page)}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => toggle(page)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 8,
                  border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-subtle)'}`,
                  background: checked ? 'var(--surface-2)' : 'var(--surface)',
                  color: 'var(--ink)', fontFamily: 'var(--font-body)', fontSize: 13.5,
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <input type="checkbox" checked={checked} readOnly tabIndex={-1} aria-hidden="true" />
                <span style={{ color: 'var(--ink-3)', display: 'inline-flex', flexShrink: 0 }}>{Ico.notion(16)}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {page.title}
                </span>
                {page.type === 'database' && <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>Database</span>}
                {showWorkspace && <span style={{ color: 'var(--ink-3)', fontSize: 12, flexShrink: 0 }}>{page.workspace}</span>}
              </button>
            );
          })}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={selected.size === 0} onClick={() => onConfirm([...selected.values()])}>
          {selected.size > 1 ? `Add ${selected.size} pages` : 'Add page'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
