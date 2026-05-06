// Connect Apps and Data — lists OAuth app tiles at the top, followed by
// a grid of every connected datasource. The "+ Connect" tile opens a chat
// with Anton to connect any data source via the credential workflow.

import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../components/Icons';
import {
  deleteDatasource, fetchDatasources,
  fetchIntegrations, startGoogleDriveAuth,
} from '../api';

const FONT_BODY    = "var(--font-body)";
const FONT_DISPLAY = "var(--font-display)";
const FONT_MONO    = "var(--font-mono)";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS  = 2 * 60 * 1000;

// ─── Google Drive logo ───────────────────────────────────────────────────

function GoogleDriveLogo({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 27h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  );
}

// ─── App tiles ───────────────────────────────────────────────────────────

function AppTile({ title, logo, connecting, onConnect }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '18px 20px',
      borderRadius: 10,
      background: 'var(--surface)',
      border: '1px solid var(--line)',
    }}>
      <div style={{ flexShrink: 0 }}>{logo}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>
          {title}
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>
        <button
          className="btn btn-primary"
          onClick={onConnect}
          disabled={connecting}
          style={{ fontSize: 13, padding: '6px 16px', opacity: connecting ? 0.7 : 1 }}
        >
          {connecting ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  );
}

function ConnectWithAntonTile({ onClick }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '18px 20px',
      borderRadius: 10,
      background: 'var(--surface)',
      border: '1px solid var(--line)',
    }}>
      <div style={{
        flexShrink: 0,
        width: 40, height: 40,
        borderRadius: 10,
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--ink-3)',
      }}>
        {Ico.database(20)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>
          Connect Data Source Interactively
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>
        <button
          className="btn btn-primary"
          onClick={onClick}
          style={{ fontSize: 13, padding: '6px 16px' }}
        >
          Connect
        </button>
      </div>
    </div>
  );
}

// ─── Collapsible section ─────────────────────────────────────────────────

function CollapsibleSection({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          width: '100%', background: 'transparent', border: 0,
          padding: '0 0 12px 0', cursor: 'pointer',
          fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 600,
          color: 'var(--ink)', textAlign: 'left',
        }}
      >
        <span style={{
          display: 'inline-flex', color: 'var(--ink-3)',
          transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform 180ms ease',
        }}>
          {Ico.chevDown(13)}
        </span>
        {title}
      </button>
      {open && children}
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────

function PageHeader() {
  return (
    <div style={{ padding: '28px 32px 0' }}>
      <h1 style={{
        margin: 0,
        fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 600,
        letterSpacing: '-0.005em', color: 'var(--ink)',
        marginBottom: 4,
      }}>Connect Apps and Data</h1>
      <p style={{
        margin: 0, fontFamily: FONT_BODY, fontSize: 13.5,
        color: 'var(--ink-3)', lineHeight: 1.5,
      }}>
        Connect Anton to the tools you already use, and automate work there.
      </p>
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
    <div style={{ padding: '0 32px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <SearchInput value={search} onChange={onSearchChange} inputRef={searchRef} />
        <SortPill value={sort} onChange={onSortChange} />
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
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--ink-3)' }}>
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

// ─── Composed view ───────────────────────────────────────────────────────

export default function CustomizeView({ connectors: initialConnectors = [], onConnectNew }) {
  const [list, setList]               = useState(Array.isArray(initialConnectors) ? initialConnectors : []);
  const [search, setSearch]           = useState('');
  const [sort, setSort]               = useState('recent');
  const [connectingId, setConnectingId] = useState(null);
  const [oauthError, setOauthError]   = useState(null);
  const searchRef = useRef(null);
  const pollRef   = useRef(null);

  const loadDatasources = async () => {
    try {
      const data = await fetchDatasources();
      const items = Array.isArray(data?.connections) ? data.connections : [];
      setList(items);
      return items;
    } catch {
      return list;
    }
  };

  useEffect(() => {
    loadDatasources();
    return () => clearInterval(pollRef.current);
  }, []);

  // Keep local mirror in sync with prop changes.
  useEffect(() => {
    setList(Array.isArray(initialConnectors) ? initialConnectors : []);
  }, [initialConnectors]);

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

  const handleConnect = async (integrationId, startAuth) => {
    setOauthError(null);
    try {
      const result = await startAuth();
      if (!result?.authUrl) {
        setOauthError('Could not start auth. Is the server running?');
        return;
      }
      window.open(result.authUrl, '_blank');
      const startedAt = result.startedAt || '';
      setConnectingId(integrationId);

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      pollRef.current = setInterval(async () => {
        if (Date.now() > deadline) {
          clearInterval(pollRef.current);
          setConnectingId(null);
          return;
        }
        try {
          const data = await fetchIntegrations();
          const item = (data?.items || []).find((i) => i.id === integrationId);
          const lastSuccessAt = item?.oauth?.lastSuccessAt || '';
          if (lastSuccessAt && (!startedAt || lastSuccessAt >= startedAt)) {
            clearInterval(pollRef.current);
            setConnectingId(null);
            loadDatasources();
          }
        } catch { /* keep polling */ }
      }, POLL_INTERVAL_MS);
    } catch (e) {
      setOauthError(e?.message || 'Something went wrong.');
      setConnectingId(null);
    }
  };

  const handleDelete = async (connection) => {
    try {
      await deleteDatasource(connection.engine, connection.name);
      await loadDatasources();
    } catch (e) {
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

  return (
    <div className="scroll-clean" style={{
      flex: 1, overflowY: 'auto',
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
    }}>
      <PageHeader />

      <div style={{ padding: '24px 32px 60px', display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Section 1: Connect Data Sources */}
        <CollapsibleSection title="Connect Data Sources">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {oauthError && (
              <div style={{
                gridColumn: '1 / -1',
                padding: '10px 14px', borderRadius: 8,
                background: 'rgba(255,82,82,0.1)',
                border: '1px solid rgba(255,82,82,0.25)',
                color: 'var(--danger)', fontSize: 13,
              }}>
                {oauthError}
              </div>
            )}
            <AppTile
              title="Google Drive"
              logo={<GoogleDriveLogo size={40} />}
              connecting={connectingId === 'google_drive'}
              onConnect={() => handleConnect('google_drive', startGoogleDriveAuth)}
            />
            <ConnectWithAntonTile onClick={onConnectNew} />
          </div>
        </CollapsibleSection>

        {/* Section 2: Connected Data Sources */}
        <CollapsibleSection title="Connected Data Sources">
          {total > 0 ? (
            <>
              <FilterRow
                search={search}
                onSearchChange={setSearch}
                sort={sort}
                onSortChange={setSort}
                total={total}
                filtered={visible.length}
                searchRef={searchRef}
              />
              <div style={{
                marginTop: 14,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 14,
              }}>
                {visible.map((c) => (
                  <ConnectionCard
                    key={`${c.engine}-${c.name}`}
                    connection={c}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </>
          ) : (
            <div style={{
              padding: '20px 0',
              fontFamily: FONT_BODY, fontSize: 13.5,
              color: 'var(--ink-4)',
            }}>
              No datasources connected yet.
            </div>
          )}
        </CollapsibleSection>

      </div>
    </div>
  );
}
