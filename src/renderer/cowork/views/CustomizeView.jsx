// Connect Apps and Data — the page that lists everything the user has
// hooked Anton up with. Mirrors the Projects page layout (header +
// filter row + grid of cards + empty state). The "+ Connect" CTA
// routes to the existing connect-data workflow at route='connect'.
//
// Replaces the previous directory-of-planned-connectors page; only
// real, configured connections show up here. Empty state nudges the
// user to wire something up.

import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../components/Icons';
import { deleteDatasource, fetchDatasources } from '../api';
import ConnectWorkflowView from './ConnectWorkflowView';

const FONT_BODY    = "var(--font-body)";
const FONT_DISPLAY = "var(--font-display)";
const FONT_MONO    = "var(--font-mono)";

// ─── Header ──────────────────────────────────────────────────────────────

function ConnectButton({ onClick, large = false }) {
  return (
    <button
      type="button"
      className="btn-primary"
      onClick={onClick}
      style={large ? { fontSize: 13.5 } : undefined}
    >
      {Ico.plus(14)} Connect
    </button>
  );
}

function PageHeader({ onConnectNew }) {
  return (
    <div style={{
      padding: '28px 32px 0',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 24, minWidth: 0,
      }}>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{
            margin: 0,
            fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 600,
            letterSpacing: '-0.005em', color: 'var(--ink)',
          }}>Connect Apps and Data</h1>
          <p style={{
            margin: 0, fontFamily: FONT_BODY, fontSize: 13.5,
            color: 'var(--ink-3)', lineHeight: 1.5,
          }}>
            Connect Anton to the tools you already use, and automate work there.
          </p>
        </div>
        <ConnectButton onClick={onConnectNew} />
      </div>
    </div>
  );
}

// ─── Filter row ──────────────────────────────────────────────────────────

function SearchInput({ value, onChange, inputRef }) {
  return (
    <div style={{
      flex: '0 1 320px', minWidth: 220,
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '7px 11px', borderRadius: 7,
      background: 'var(--surface-2)',
      border: '1px solid var(--line)',
    }}>
      <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--ink-3)' }}>
        {Ico.search(13)}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder="Search connections"
        style={{
          flex: 1, minWidth: 0,
          background: 'transparent', border: 0, outline: 'none',
          fontFamily: FONT_BODY, fontSize: 12.5,
          color: 'var(--ink-2)',
        }}
      />
      <span style={{
        flexShrink: 0,
        padding: '1px 5px', borderRadius: 3,
        background: 'var(--surface-3)',
        border: '1px solid var(--line-2)',
        fontFamily: FONT_MONO, fontSize: 10,
        color: 'var(--ink-4)',
      }}>⌘K</span>
    </div>
  );
}

const SORT_OPTIONS = [
  { id: 'recent', label: 'Recent' },
  { id: 'name',   label: 'Name' },
  { id: 'engine', label: 'Engine' },
];

function SortPill({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const current = SORT_OPTIONS.find((o) => o.id === value) || SORT_OPTIONS[0];
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 11px', borderRadius: 7,
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
          color: 'var(--ink-2)',
          fontFamily: FONT_BODY, fontSize: 12.5,
          cursor: 'pointer',
        }}
      >
        <span style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>Sort:</span>
        <span>{current.label}</span>
        <span style={{ display: 'inline-flex', color: 'var(--ink-3)' }}>
          {Ico.chevDown(11)}
        </span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0,
          minWidth: 160, zIndex: 20,
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 8,
          boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
          padding: '4px 0',
        }}>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => { onChange?.(opt.id); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center',
                width: 'calc(100% - 8px)', margin: '0 4px',
                padding: '7px 10px', borderRadius: 5,
                background: opt.id === value ? 'var(--surface-2)' : 'transparent',
                border: 0,
                fontFamily: FONT_BODY, fontSize: 12.5,
                color: 'var(--ink-2)', textAlign: 'left',
                cursor: 'pointer',
              }}
              onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = opt.id === value ? 'var(--surface-2)' : 'transparent'; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({ search, onSearchChange, sort, onSortChange, total, filtered, searchRef }) {
  const filterActive = (search || '').trim().length > 0;
  const countText = filterActive
    ? `Showing ${filtered} of ${total}`
    : `${total} ${total === 1 ? 'connection' : 'connections'}`;
  return (
    <div style={{
      padding: '0 32px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <SearchInput value={search} onChange={onSearchChange} inputRef={searchRef} />
        <SortPill value={sort} onChange={onSortChange} />
        <span style={{ flex: 1 }} />
      </div>
      <div style={{
        fontFamily: FONT_MONO, fontSize: 11,
        color: 'var(--ink-4)', letterSpacing: '0.04em',
      }}>{countText}</div>
    </div>
  );
}

// ─── Connection card ─────────────────────────────────────────────────────

function ConnectionCard({ connection, onDelete }) {
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const engine = connection.engine || 'unknown';
  const name = connection.name || connection.slug || 'unnamed';
  const updated = connection.updated_at || connection.updatedAt || null;

  const handleRemove = async (e) => {
    e.stopPropagation();
    if (!window.confirm(`Disconnect ${engine}/${name}?`)) return;
    setBusy(true);
    try {
      await onDelete?.(connection);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? 'var(--surface-2)' : 'var(--surface)',
        border: `1px solid ${hover ? 'var(--line-2)' : 'var(--line)'}`,
        borderRadius: 10,
        padding: '14px 16px',
        minHeight: 120,
        display: 'flex', flexDirection: 'column', gap: 10,
        transition: 'background .15s ease, border-color .15s ease',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{
          display: 'inline-flex', flexShrink: 0,
          color: 'var(--ink-3)',
        }}>
          {Ico.database(14)}
        </span>
        <span style={{
          flex: 1, minWidth: 0,
          fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600,
          letterSpacing: '-0.005em', color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{name}</span>
        <span style={{
          flexShrink: 0,
          fontFamily: FONT_MONO, fontSize: 10.5,
          color: 'var(--ink-4)', letterSpacing: '0.04em',
          textTransform: 'uppercase',
          padding: '2px 7px', borderRadius: 99,
          background: 'var(--surface-3)',
          border: '1px solid var(--line)',
        }}>{engine}</span>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        borderTop: '1px solid var(--line)',
        paddingTop: 10,
      }}>
        <span style={{
          flex: 1,
          fontFamily: FONT_MONO, fontSize: 10.5,
          color: 'var(--ink-4)', letterSpacing: '0.04em',
        }}>
          {updated ? `updated ${updated}` : 'connected'}
        </span>
        <button
          type="button"
          onClick={handleRemove}
          disabled={busy}
          title="Disconnect"
          style={{
            background: 'transparent',
            border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
            color: 'var(--danger)',
            padding: '4px 10px', borderRadius: 7,
            fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 500,
            cursor: busy ? 'progress' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Removing…' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────

function EmptyState({ onConnectNew }) {
  return (
    <div style={{
      flex: 1, minHeight: 360,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 14, padding: '40px 24px',
    }}>
      <span style={{ display: 'inline-flex', color: 'var(--ink-4)' }}>{Ico.link(32)}</span>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
        No apps connected yet
      </div>
      <div style={{
        fontFamily: FONT_BODY, fontSize: 13.5, color: 'var(--ink-3)',
        maxWidth: 380, textAlign: 'center', lineHeight: 1.5,
      }}>
        Connectors shape how Anton works with you. Hook up the apps and
        databases you already use, and Anton will automate work there.
      </div>
      <ConnectButton onClick={onConnectNew} large />
    </div>
  );
}

// ─── Composed view ───────────────────────────────────────────────────────

export default function CustomizeView({ connectors: initialConnectors = [], onConnectNew }) {
  const [list, setList] = useState(Array.isArray(initialConnectors) ? initialConnectors : []);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const searchRef = useRef(null);
  // Sub-view: when true, the connect-data workflow renders in place
  // (the apps directory + per-app credential form). Hitting "Back"
  // from inside the workflow returns to this listing. Local-only —
  // the App-level route stays at 'customize' so the sidebar's active
  // state is correct throughout.
  const [showWorkflow, setShowWorkflow] = useState(false);

  // Fetch fresh on mount so OAuth connections made via "Connect Apps"
  // tab are visible without requiring a full app reload.
  useEffect(() => {
    fetchDatasources()
      .then((data) => setList(Array.isArray(data?.connections) ? data.connections : []))
      .catch(() => setList(Array.isArray(initialConnectors) ? initialConnectors : []));
  }, []);

  // Keep local mirror in sync with prop changes — refresh after add /
  // remove flips the App-level state.
  useEffect(() => {
    setList(Array.isArray(initialConnectors) ? initialConnectors : []);
  }, [initialConnectors]);

  const handleConnectNew = () => {
    // Delegate to the parent when one is provided — that's the
    // current path: App.jsx opens a fresh chat with a synthesized
    // greeting and routes the user there. Anton drives the rest
    // via request_credentials. Falls back to the in-page apps
    // directory only when no handler is wired (older callers).
    if (onConnectNew) {
      onConnectNew();
      return;
    }
    setShowWorkflow(true);
  };

  const handleWorkflowClose = async () => {
    setShowWorkflow(false);
    // Returning from the workflow likely added/removed connections —
    // refetch so the listing reflects whatever changed.
    try {
      const fresh = await fetchDatasources();
      setList(Array.isArray(fresh?.connections) ? fresh.connections : []);
    } catch {}
  };

  // ⌘K focuses the search input.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleDelete = async (connection) => {
    try {
      await deleteDatasource(connection.engine, connection.name);
      const fresh = await fetchDatasources();
      setList(Array.isArray(fresh?.connections) ? fresh.connections : []);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[connectors] delete failed', e);
      alert(`Could not disconnect: ${e?.message || e}`);
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = (list || []).slice();
    if (q) {
      out = out.filter((c) =>
        (c.name || '').toLowerCase().includes(q)
        || (c.engine || '').toLowerCase().includes(q),
      );
    }
    out.sort((a, b) => {
      switch (sort) {
        case 'name':   return (a.name || '').localeCompare(b.name || '');
        case 'engine': return (a.engine || '').localeCompare(b.engine || '');
        case 'recent':
        default: {
          const ta = Date.parse(a.updated_at || a.updatedAt || '') || 0;
          const tb = Date.parse(b.updated_at || b.updatedAt || '') || 0;
          return tb - ta;
        }
      }
    });
    return out;
  }, [list, search, sort]);

  const total = list.length;

  // While the workflow is open, hand the whole content area over to it.
  // The workflow has its own header with a "Back" button that calls
  // handleWorkflowClose, which refetches and pops back to the listing.
  if (showWorkflow) {
    return <ConnectWorkflowView onClose={handleWorkflowClose} />;
  }

  return (
    <div className="scroll-clean" style={{
      flex: 1, overflowY: 'auto',
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
    }}>
      <PageHeader onConnectNew={handleConnectNew} />

      <div style={{ height: 18 }} />

      {total > 0 && (
        <FilterRow
          search={search}
          onSearchChange={setSearch}
          sort={sort}
          onSortChange={setSort}
          total={total}
          filtered={visible.length}
          searchRef={searchRef}
        />
      )}

      {total === 0 ? (
        <EmptyState onConnectNew={handleConnectNew} />
      ) : (
        <div style={{
          padding: '6px 32px 60px',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14,
          marginTop: 18,
        }}>
          {visible.map((c) => (
            <ConnectionCard
              key={`${c.engine}-${c.name}`}
              connection={c}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
