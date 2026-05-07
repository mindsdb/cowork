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
import {
  PageHeader,
  FilterRow,
  SearchInput,
  SortPill,
  useCollectionShortcut,
} from '../components/collection';

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

// Sort options for the connections collection.
const SORT_OPTIONS = [
  { id: 'recent', label: 'Recent' },
  { id: 'name',   label: 'Name' },
  { id: 'engine', label: 'Engine' },
];

function ConnectionsCounts({ search, total, filtered }) {
  const filterActive = (search || '').trim().length > 0;
  const countText = filterActive
    ? `Showing ${filtered} of ${total}`
    : `${total} ${total === 1 ? 'connection' : 'connections'}`;
  return <>{countText}</>;
}

// ─── Connection card ─────────────────────────────────────────────────────

// Trailing dashed card that lives at the end of the connections
// grid, mirroring the "+ New project" tile in ProjectsView. Click
// dispatches to the parent's handleConnectNew (same path the page
// header's "+ Connect" button takes — opens the connector picker).
// Only rendered when there's at least one existing connection — the
// EmptyState already covers the zero-connection case.
function NewConnectionCard({ onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        minHeight: 120, borderRadius: 10,
        padding: '14px 16px',
        background: 'transparent',
        border: `1px dashed ${hover ? 'var(--accent)' : 'var(--line-2)'}`,
        color: hover ? 'var(--accent)' : 'var(--ink-3)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 8, cursor: 'pointer',
        transition: 'border-color .15s ease, color .15s ease',
        font: 'inherit',
      }}
    >
      <span style={{ display: 'inline-flex' }}>{Ico.plus(16)}</span>
      <span style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 500 }}>
        New connection
      </span>
    </button>
  );
}

function ConnectionCard({ connection, onDelete, onModify }) {
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

  // Card click → modify. Mirrors the "+ Connect" flow: pulls up the
  // same form (same engine spec), pre-filled with this connection's
  // name. Submitting overwrites the existing entry in the data vault.
  const canModify = typeof onModify === 'function';
  const handleCardClick = () => {
    if (!canModify || busy) return;
    onModify(connection);
  };

  return (
    <div
      role={canModify ? 'button' : undefined}
      tabIndex={canModify ? 0 : undefined}
      onClick={canModify ? handleCardClick : undefined}
      onKeyDown={canModify ? (e) => { if (e.key === 'Enter') handleCardClick(); } : undefined}
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
        cursor: canModify ? 'pointer' : 'default',
        outline: 'none',
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

export default function CustomizeView({ connectors: initialConnectors = [], onConnectNew, onModifyConnection }) {
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

  // Fetch fresh on every mount so connections made outside this view
  // (e.g. browser OAuth flow from the chat panel) are always visible.
  useEffect(() => {
    fetchDatasources()
      .then((data) => setList(Array.isArray(data?.connections) ? data.connections : []))
      .catch(() => {});
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
  useCollectionShortcut(searchRef);

  // Auto-open the connect flow when the user lands here without any
  // connectors set up yet. Prevents the empty-state click ceremony
  // (page → "+ Connect" button → modal) for first-time users — the
  // modal appears immediately. Guarded by a ref so it fires once per
  // mount, and delayed slightly so a still-in-flight `fetchDatasources`
  // can populate `initialConnectors` first (avoids briefly opening the
  // modal for users who actually have connectors).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    const id = setTimeout(() => {
      if (autoOpenedRef.current) return;
      // Only auto-open when nothing is configured AND the workflow
      // isn't already on screen for some other reason.
      if ((list || []).length === 0 && !showWorkflow) {
        autoOpenedRef.current = true;
        handleConnectNew();
      }
    }, 200);
    return () => clearTimeout(id);
    // We intentionally only watch `list` so the auto-open can fire
    // after the prop sync updates the local mirror once the initial
    // fetch settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

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
    // Background intentionally omitted so the gravity-field canvas
    // painted behind the React root shows through.
    <div className="scroll-clean" style={{
      flex: 1, overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
    }}>
      <PageHeader
        title="Connect Apps and Data"
        subtitle="Connect Anton to the tools you already use, and automate work there."
        actions={<ConnectButton onClick={handleConnectNew} />}
      />

      <div style={{ height: 18 }} />

      {total > 0 && (
        <FilterRow
          search={
            <SearchInput
              value={search}
              onChange={setSearch}
              inputRef={searchRef}
              placeholder="Search connections"
            />
          }
          sort={<SortPill value={sort} onChange={setSort} options={SORT_OPTIONS} />}
          counts={
            <ConnectionsCounts search={search} total={total} filtered={visible.length} />
          }
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
              onModify={onModifyConnection}
            />
          ))}
          {/* Trailing dashed "New connection" card — appears only
              when there's at least one existing connection (the
              EmptyState handles the zero-connection case with its
              own larger CTA). Mirrors the Projects pattern. */}
          <NewConnectionCard onClick={handleConnectNew} />
        </div>
      )}
    </div>
  );
}
