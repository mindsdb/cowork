import { useEffect, useRef, useState } from 'react';
import Ico from './Icons';

function ResultIcon({ type }) {
  if (type === 'project') return Ico.folder(15);
  if (type === 'artifact') return Ico.sparkle(15);
  if (type === 'attachment') return Ico.attach(15);
  if (type === 'schedule') return Ico.clock(15);
  if (type === 'pin') return Ico.pin(15);
  return Ico.list(15);
}

export default function SearchModal({ open, onClose, onSearch, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      setBusy(true);
      setError('');
      try {
        const data = await onSearch(query);
        setResults(data.results || []);
      } catch (err) {
        setError(err.message || 'Search failed.');
      } finally {
        setBusy(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [open, query, onSearch]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="search-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="search-head">
          <span>{Ico.search(17)}</span>
          <input
            ref={inputRef}
            value={query}
            type="search"
            placeholder="Search Anton Cowork"
            aria-label="Search Anton Cowork"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="mini-icon-btn" title="Close" onClick={onClose}>x</button>
        </div>
        <div className="search-results">
          {results.map((result) => (
            <button
              key={`${result.type}-${result.id}`}
              className="search-result"
              onClick={() => { onSelect(result); onClose(); }}
            >
              <span className="search-result-icon">{ResultIcon(result.type)}</span>
              <span className="search-result-body">
                <strong>{result.title}</strong>
                <small>{result.subtitle}</small>
              </span>
              <span className="search-result-type">{result.type}</span>
            </button>
          ))}
          {busy && <div className="search-empty">Searching...</div>}
          {error && <div className="dialog-error">{error}</div>}
          {!busy && query.trim() && results.length === 0 && !error && <div className="search-empty">No Anton Cowork results found.</div>}
          {!query.trim() && <div className="search-empty">Tasks, projects, artifacts, attachments, schedules, and pins are searchable.</div>}
        </div>
      </div>
    </div>
  );
}
