import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
// Namespace import + typeof guards — see useBrowserState.js.
import * as host from '../../../platform/host';

// Chrome-style find bar. Lives in a DOM strip ABOVE the native view (the
// placeholder is a flex column, so the view's bounds shrink below it — no
// OS-level view to fight). Enter = next, Shift+Enter = prev, Esc = close.
export default function FindBar({ tabId, onClose }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null); // {matches, activeMatchOrdinal}
  const inputRef = useRef(null);
  const lastSentRef = useRef('');

  useEffect(() => {
    const id = setTimeout(() => { try { inputRef.current?.focus(); inputRef.current?.select(); } catch {} }, 20);
    return () => clearTimeout(id);
  }, []);

  // Reset when switching tabs — Chrome keeps per-tab find state, we keep it
  // simple and start fresh.
  useEffect(() => {
    setResult(null);
    lastSentRef.current = '';
  }, [tabId]);

  const run = async (text, { findNext = false, forward = true } = {}) => {
    const q = text.trim();
    if (!q || !tabId) {
      setResult(null);
      lastSentRef.current = '';
      if (tabId) host.browserStopFind?.(tabId);
      return;
    }
    // Skip the round-trip for an identical query (arrow-key re-renders).
    const key = `${q}|${findNext}|${forward}`;
    if (key === lastSentRef.current) return;
    lastSentRef.current = key;
    const res = await host.browserFindInPage?.({ tabId, text: q, findNext, forward });
    if (res && res.ok !== false) setResult(res);
  };

  // Debounced live search as you type.
  useEffect(() => {
    const id = setTimeout(() => run(query), 160);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tabId]);

  const count = result
    ? result.matches === 0 && lastSentRef.current
      ? 'No results'
      : `${result.activeMatchOrdinal}/${result.matches}`
    : '';

  return (
    <div
      role="search"
      style={{
        flex: '0 0 auto', height: 34,
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 10px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--line)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <span style={{ display: 'inline-flex', flex: '0 0 auto', color: 'var(--ink-4)' }}>{Ico.search(13)}</span>
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Find in page"
        aria-label="Find in page"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); run(query, { findNext: true, forward: !e.shiftKey }); }
          else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        style={{
          flex: 1, minWidth: 0, height: 24,
          background: 'transparent', border: 0, outline: 'none',
          color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit',
        }}
      />
      <span style={{
        flex: '0 0 auto', minWidth: 56, textAlign: 'right',
        fontSize: 11.5, color: result && result.matches === 0 && lastSentRef.current ? 'var(--warn)' : 'var(--ink-4)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {count}
      </span>
      <button
        type="button" className="icon-btn" aria-label="Previous match"
        disabled={!result || result.matches === 0}
        onClick={() => run(query, { findNext: true, forward: false })}
      >
        {Ico.chevUp?.(13) ?? '‹'}
      </button>
      <button
        type="button" className="icon-btn" aria-label="Next match"
        disabled={!result || result.matches === 0}
        onClick={() => run(query, { findNext: true, forward: true })}
      >
        {Ico.chevDown(13)}
      </button>
      <button type="button" className="icon-btn" aria-label="Close find bar" onClick={onClose}>
        {Ico.close(12)}
      </button>
    </div>
  );
}
