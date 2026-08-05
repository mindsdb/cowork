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
import { Alert, Button, EmptyState } from '../components/ui';
import { CONNECTIONS_VAULT_KEEP, deleteDatasource, fetchConnector, fetchDatasources, fetchSavedConnection } from '../api';
import { host } from '../../platform/host';
import Spinner from '../components/ui/Spinner';
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
    <Button
      variant="primary"
      onClick={onClick}
      style={large ? { fontSize: 13.5 } : undefined}
    >
      {Ico.plus(14)} Connect
    </Button>
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
  // Human-facing title (label or derived identity, e.g. "Support" /
  // "user@gmail.com"); falls back to the slug. `name` stays the identity used
  // for disconnect/modify.
  const displayName =
    connection.display_name || connection.displayName || name;
  const updated = connection.updated_at || connection.updatedAt || null;
  const needsReconnect = connection.status === 'needs_reconnect';

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
        background: needsReconnect
          ? 'color-mix(in srgb, var(--warning, #f5a623) 8%, var(--surface))'
          : (hover ? 'var(--surface-2)' : 'var(--surface)'),
        border: needsReconnect
          ? `1px solid color-mix(in srgb, var(--warning, #f5a623) 45%, transparent)`
          : `1px solid ${hover ? 'var(--line-2)' : 'var(--line)'}`,
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
          color: needsReconnect ? 'var(--warning, #f5a623)' : 'var(--ink-3)',
        }} title={needsReconnect ? 'Reconnection required' : undefined}>
          {needsReconnect
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>
            : Ico.database(14)}
        </span>
        <span style={{
          flex: 1, minWidth: 0,
          fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600,
          letterSpacing: '0', color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={displayName !== name ? name : undefined}>{displayName}</span>
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

      {needsReconnect && (
        <div style={{
          fontFamily: FONT_BODY, fontSize: 12, fontWeight: 500,
          color: 'var(--warning, #f5a623)',
        }}>
          Reconnection required — click to fix
        </div>
      )}

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
        <Button
          variant="danger"
          size="sm"
          onClick={handleRemove}
          disabled={busy}
          title="Disconnect"
        >
          {busy ? 'Removing…' : 'Disconnect'}
        </Button>
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────

// ─── Connection detail panel ──────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return iso; }
}

function humanLabel(name) {
  return String(name || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function MetaRow({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{
        width: 100, flexShrink: 0,
        fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-4)',
      }}>{label}</span>
      <span style={{
        fontFamily: FONT_MONO, fontSize: 12, color: 'var(--ink)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value || '—'}</span>
    </div>
  );
}

function ConnectionDetailPanel({ connection, onClose, onDisconnect, onReconnect }) {
  const [spec, setSpec] = useState(null);
  const [saved, setSaved] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pickerState, setPickerState] = useState({ status: 'idle' });
  // Bumped by both handleCancelPicker AND every new handlePickFiles call, so
  // a pick attempt's own continuation can tell whether it's still the
  // active one — a single shared boolean "was cancel ever clicked" flag
  // let a fast cancel-then-repick have the FIRST attempt's stale resolution
  // clobber the second attempt's live state, since resetting the flag for
  // the new attempt made the old attempt's cancelled-check pass too. Must
  // be declared before the `if (!connection) return null;` below — every
  // render must call the same hooks (Rules of Hooks).
  const pickerAttemptRef = useRef(0);

  useEffect(() => {
    if (!connection) return;
    setLoading(true);
    setSpec(null);
    setSaved(null);
    setPickerState({ status: 'idle' });
    Promise.all([
      fetchConnector(connection.engine).catch(() => null),
      fetchSavedConnection(connection.engine, connection.name).catch(() => null),
    ]).then(([connSpec, savedData]) => {
      setSpec(connSpec);
      setSaved(savedData);
      setLoading(false);
      const rawPicked = savedData?.fields?._picked_files;
      if (rawPicked) {
        try {
          setPickerState({ status: 'done', files: JSON.parse(rawPicked) });
        } catch {
          // Malformed field — behave as if nothing was picked yet rather
          // than crash the panel.
        }
      }
    });
  }, [connection?.engine, connection?.name]);

  if (!connection) return null;

  const secureKeys = new Set(saved?.secureKeys || []);
  const vaultFields = saved?.fields || {};
  const vaultKeys = new Set(Object.keys(vaultFields));

  // Find the form method whose field names best overlap with the stored
  // vault keys so we can supplement display with any expected-but-empty
  // params (e.g. a 'username' field that was left blank when saving).
  const methods = spec?.form?.methods || [];
  let bestMethod = null, bestScore = -1;
  for (const m of methods) {
    const score = (m.fields || []).filter((f) => vaultKeys.has(f.name)).length;
    if (score > bestScore) { bestScore = score; bestMethod = m; }
  }
  const specFields = bestMethod?.fields || spec?.form?.fields || [];
  const specKeys = new Set(specFields.map((f) => f.name));

  const handlePickFiles = async () => {
    const accountEmail = vaultFields.account_email;
    if (!accountEmail) {
      setPickerState({ status: 'error', reason: 'No account email on file for this connection — try reconnecting.' });
      return;
    }
    // Claim this attempt's own id — a stale attempt's continuation (below)
    // checks this against the CURRENT ref value, not a shared "was cancel
    // ever clicked" boolean, so a fast cancel-then-repick can't have the
    // first attempt's late resolution clobber the second attempt's state.
    const attemptId = ++pickerAttemptRef.current;
    setPickerState({ status: 'waiting' });
    try {
      const result = await host.pickDriveFiles(connection.engine, connection.name, accountEmail);
      if (pickerAttemptRef.current !== attemptId) return; // superseded — cancelled or a newer pick started
      if (!result.ok) {
        setPickerState({ status: 'error', reason: result.reason || 'Could not open the Drive picker.' });
        return;
      }
      setPickerState({ status: 'done', files: result.files || [], failed: result.failed || [] });
    } catch (err) {
      if (pickerAttemptRef.current !== attemptId) return;
      setPickerState({ status: 'error', reason: err?.message || String(err) });
    }
  };

  const handleCancelPicker = () => {
    pickerAttemptRef.current++; // invalidates the in-flight attempt's eventual resolution
    host.cancelDrivePicker();
    setPickerState({ status: 'idle' });
  };

  // Display list: spec fields in order (vault value where available),
  // followed by any vault fields not covered by the spec.
  const displayFields = [
    ...specFields.map((f) => ({
      key: f.name,
      label: f.label || humanLabel(f.name),
      value: vaultFields[f.name] ?? null,
      isSecret: f.secret === true || f.type === 'password'
        || secureKeys.has(f.name) || vaultFields[f.name] === CONNECTIONS_VAULT_KEEP,
    })),
    ...Object.entries(vaultFields)
      .filter(([k]) => !specKeys.has(k) && k !== '_picked_files')
      .map(([key, value]) => ({
        key,
        label: humanLabel(key),
        value,
        isSecret: secureKeys.has(key) || value === CONNECTIONS_VAULT_KEEP,
      })),
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 70,
          background: 'rgba(0,0,0,0.18)',
        }}
      />

      {/* Slide-in panel */}
      <div
        role="dialog"
        aria-label={`${spec?.label || connection.engine} connection details`}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 71,
          width: 'min(400px, 92vw)',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--line)',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.12)',
          display: 'flex', flexDirection: 'column',
          fontFamily: FONT_BODY,
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '18px 20px 16px',
          borderBottom: '1px solid var(--line)',
          flexShrink: 0,
        }}>
          <span style={{
            display: 'inline-grid', placeItems: 'center',
            width: 36, height: 36, borderRadius: 8,
            background: 'var(--surface-2)', flexShrink: 0,
          }}>
            {spec?.logo_url
              ? <img src={spec.logo_url} alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} />
              : <span style={{ color: 'var(--ink-3)', display: 'inline-flex' }}>{Ico.database(18)}</span>
            }
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="s-h3" style={{
              color: 'var(--ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {spec?.label || connection.engine}
            </div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: 'var(--ink-4)', marginTop: 1 }}>
              {connection.name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 0,
              color: 'var(--ink-3)', cursor: 'pointer',
              width: 28, height: 28, borderRadius: 6,
              display: 'inline-grid', placeItems: 'center',
              fontSize: 18, lineHeight: 1, flexShrink: 0,
            }}
          >×</button>
        </div>

        {/* Body */}
        <div className="scroll-clean" style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--ink-4)' }}>Loading…</div>
          ) : (
            <>
              {/* Meta */}
              <div style={{
                padding: '12px 14px', marginBottom: 20,
                background: 'var(--surface-2)',
                borderRadius: 8, border: '1px solid var(--line)',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <MetaRow label="Engine" value={connection.engine} />
                {saved?.updatedAt && <MetaRow label="Last updated" value={fmtDate(saved.updatedAt)} />}
                {saved?.createdAt && <MetaRow label="Connected" value={fmtDate(saved.createdAt)} />}
              </div>

              {/* Credentials */}
              {displayFields.length > 0 && (
                <>
                  <div style={{
                    fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600,
                    letterSpacing: '0.05em', textTransform: 'uppercase',
                    color: 'var(--ink-3)', marginBottom: 8,
                  }}>
                    Credentials
                  </div>
                  <div style={{
                    border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden',
                    marginBottom: 20,
                  }}>
                    {displayFields.map((f, i) => (
                      <div
                        key={f.key}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 14px',
                          background: 'var(--surface)',
                          borderBottom: i < displayFields.length - 1 ? '1px solid var(--line)' : 'none',
                        }}
                      >
                        <span style={{
                          width: 120, flexShrink: 0,
                          fontFamily: FONT_BODY, fontSize: 12,
                          color: 'var(--ink-3)', fontWeight: 500,
                        }}>
                          {f.label}
                        </span>
                        <span style={{
                          flex: 1, fontFamily: FONT_MONO, fontSize: 12,
                          color: f.isSecret ? 'var(--ink-4)' : (f.value ? 'var(--ink)' : 'var(--ink-4)'),
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          fontStyle: (!f.isSecret && !f.value) ? 'italic' : 'normal',
                        }}>
                          {f.isSecret ? '•••••••• saved' : (f.value || '—')}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Drive file access — drive.file only grants the app files
                  it creates itself; picking files here grants access to
                  existing ones without widening the OAuth scope. */}
              {connection.engine === 'google_drive' && (
                <>
                  <div style={{
                    fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600,
                    letterSpacing: '0.05em', textTransform: 'uppercase',
                    color: 'var(--ink-3)', marginBottom: 8,
                  }}>
                    Drive files
                  </div>
                  <div style={{
                    border: '1px solid var(--line)', borderRadius: 8,
                    padding: '12px 14px', marginBottom: 20,
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                      This connection can only read files it created itself. Select any files below —
                      including several at once, or whole Shared Drives — to grant access to them too.
                    </div>
                    {pickerState.status === 'waiting' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <Spinner style={{ color: 'var(--ink-3)' }} />
                        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                          Opened in your browser — pick your files there, then come back. Confirming access can take a few seconds after you return.
                        </span>
                        <Button variant="subtle" size="sm" onClick={handleCancelPicker}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        onClick={handlePickFiles}
                        style={{ alignSelf: 'flex-start' }}
                      >
                        Select files from Google Drive
                      </Button>
                    )}
                    {pickerState.status === 'error' && (
                      <div style={{ fontSize: 12, color: 'var(--danger)' }}>{pickerState.reason}</div>
                    )}
                    {pickerState.status === 'done' && pickerState.failed?.length > 0 && (
                      <Alert variant="danger">
                        Google didn't actually grant access to {pickerState.failed.length === 1 ? 'this file' : 'these files'} —
                        try picking {pickerState.failed.length === 1 ? 'it' : 'them'} again:
                        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                          {pickerState.failed.map((f) => (
                            <li key={f.id}>{f.name} ({f.reason})</li>
                          ))}
                        </ul>
                      </Alert>
                    )}
                    {pickerState.status === 'done' && pickerState.files.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>No files selected.</div>
                    )}
                    {pickerState.status === 'done' && pickerState.files.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                          Granted access to {pickerState.files.length} file{pickerState.files.length === 1 ? '' : 's'}:
                        </div>
                        {pickerState.files.map((f) => (
                          <a
                            key={f.id}
                            href={f.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              fontSize: 12, color: 'var(--ink)',
                              textDecoration: 'none',
                              padding: '4px 6px', borderRadius: 6,
                              background: 'var(--surface-2)',
                              overflow: 'hidden',
                            }}
                          >
                            {f.iconUrl && <img src={f.iconUrl} alt="" style={{ width: 14, height: 14, flexShrink: 0 }} />}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--line)',
          display: 'flex', flexDirection: 'column', gap: 8,
          flexShrink: 0,
        }}>
          {saved?.fields?.status === 'needs_reconnect' && (
            <Alert variant="warning" title="Reconnection required">
              Access for this connection has expired or was revoked. Reconnect to restore access, or remove the connection.
            </Alert>
          )}
          {spec && (
            <Button
              variant="primary"
              onClick={() => {
                if (!window.confirm(
                  `The existing ${spec.label || connection.engine} connection will be removed and you'll connect it again from scratch. Continue?`
                )) return;
                onReconnect?.(connection, spec);
              }}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Reconnect
            </Button>
          )}
          <Button
            variant="danger"
            block
            onClick={() => {
              if (!window.confirm(`Disconnect ${connection.engine}/${connection.name}?`)) return;
              onDisconnect?.(connection, saved);
              onClose();
            }}
          >
            {Ico.trash(14)}
            Remove
          </Button>
        </div>
      </div>
    </>
  );
}

// ─── Composed view ───────────────────────────────────────────────────────

export default function CustomizeView({
  connectors: initialConnectors = [],
  onConnectNew,
  onModifyConnection,
  onReconnect,
  /** Called with the fresh connections array so App can update the sidebar badge + composer list. */
  onConnectionsSynced,
  agentLabel = 'the agent',
}) {
  const [list, setList] = useState(Array.isArray(initialConnectors) ? initialConnectors : []);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [selectedConn, setSelectedConn] = useState(null);
  const searchRef = useRef(null);
  const onConnectionsSyncedRef = useRef(onConnectionsSynced);
  onConnectionsSyncedRef.current = onConnectionsSynced;
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
      .then((data) => {
        const next = Array.isArray(data?.connections) ? data.connections : [];
        setList(next);
        onConnectionsSyncedRef.current?.(next);
      })
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
      const next = Array.isArray(fresh?.connections) ? fresh.connections : [];
      setList(next);
      onConnectionsSyncedRef.current?.(next);
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

  const handleDelete = async (connection, savedDetail) => {
    try {
      // For builtin OAuth connections in Electron, keychain:revoke stops the
      // refresh loop, removes the keychain entry, and deletes the vault record.
      if (host.isElectron) {
        const detail = savedDetail || await fetchSavedConnection(connection.engine, connection.name).catch(() => null);
        const accountEmail = detail?.fields?.account_email;
        if (detail?.method === 'browser_oauth_builtin' && accountEmail) {
          await host.keychainRevoke(connection.engine, connection.name, accountEmail);
          const fresh = await fetchDatasources();
          const next = Array.isArray(fresh?.connections) ? fresh.connections : [];
          setList(next);
          onConnectionsSyncedRef.current?.(next);
          // Project files' Context card holds its own Google Drive file
          // list and has no other way to learn a connection just vanished
          // (and with it, that connection's _picked_files grant).
          window.dispatchEvent(new CustomEvent('anton:connections-changed'));
          return;
        }
      }
      await deleteDatasource(connection.engine, connection.name);
      const fresh = await fetchDatasources();
      const next = Array.isArray(fresh?.connections) ? fresh.connections : [];
      setList(next);
      onConnectionsSyncedRef.current?.(next);
      window.dispatchEvent(new CustomEvent('anton:connections-changed'));
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
        subtitle={`Connect ${agentLabel} to the tools you already use, and automate work there.`}
        actions={<ConnectButton onClick={handleConnectNew} />}
      />


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
        <EmptyState
          icon={<span style={{ display: 'inline-flex', color: 'var(--ink-4)' }}>{Ico.link(32)}</span>}
          title="No apps connected yet"
          description={`Connectors shape how ${agentLabel} works with you. Hook up the apps and databases you already use, and ${agentLabel} will automate work there.`}
          action={<ConnectButton onClick={handleConnectNew} large />}
          style={{ flex: 1 }}
        />
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
              onModify={setSelectedConn}
            />
          ))}
          {/* Trailing dashed "New connection" card — appears only
              when there's at least one existing connection (the
              EmptyState handles the zero-connection case with its
              own larger CTA). Mirrors the Projects pattern. */}
          <NewConnectionCard onClick={handleConnectNew} />
        </div>
      )}

      {selectedConn && (
        <ConnectionDetailPanel
          connection={selectedConn}
          onClose={() => setSelectedConn(null)}
          onDisconnect={async (conn, savedDetail) => {
            await handleDelete(conn, savedDetail);
            setSelectedConn(null);
          }}
          onReconnect={async (conn, spec) => {
            await handleDelete(conn);
            setSelectedConn(null);
            onReconnect?.(spec);
          }}
        />
      )}
    </div>
  );
}
