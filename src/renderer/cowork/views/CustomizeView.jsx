// Connect Apps and Data — the page that lists everything the user has
// hooked Anton up with. Mirrors the Projects page layout (header +
// filter row + grid of cards + empty state). The "+ Connect" CTA
// routes to the existing connect-data workflow at route='connect'.
//
// Replaces the previous directory-of-planned-connectors page; only
// real, configured connections show up here. Empty state nudges the
// user to wire something up.

import { useEffect, useMemo, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
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
import { cn } from '../lib/cn';

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
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-line-2 bg-transparent px-4 py-3.5 text-ink-3 [font:inherit] [transition:border-color_.15s_ease,color_.15s_ease] hover:border-accent hover:text-accent"
    >
      <span className="inline-flex">{Ico.plus(16)}</span>
      <span className="font-[family-name:var(--font-body)] text-[13px] font-medium">
        New connection
      </span>
    </button>
  );
}

function ConnectionCard({ connection, onDelete, onModify }) {
  const [busy, setBusy] = useState(false);
  const engine = connection.engine || 'unknown';
  const name = connection.name || connection.slug || 'unnamed';
  // Card title is the user-assigned label; a dash for pre-migration
  // connections that don't have one yet. Identity (host/db, email, etc.)
  // moves to a subtitle line below instead of being the title.
  const title = connection.user_label || '—';
  const subtitle = connection.display_name || connection.displayName || null;
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
      className={cn(
        'relative flex min-h-[120px] flex-col gap-2.5 rounded-[10px] px-4 py-3.5 outline-none',
        '[transition:background_.15s_ease,border-color_.15s_ease]',
        canModify ? 'cursor-pointer' : 'cursor-default',
        needsReconnect
          ? 'border border-solid border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,var(--surface))]'
          : 'border border-solid border-line bg-surface hover:border-line-2 hover:bg-surface-2',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn('inline-flex shrink-0', needsReconnect ? 'text-warning' : 'text-ink-3')}
          title={needsReconnect ? 'Reconnection required' : undefined}
        >
          {needsReconnect
            ? <TriangleAlert size={14} strokeWidth={1.5} aria-hidden="true" />
            : Ico.database(14)}
        </span>
        <span
          className="flex-1 min-w-0 truncate font-[family-name:var(--font-display)] text-[16px] font-semibold tracking-normal text-ink"
          title={title !== name ? name : undefined}
        >{title}</span>
        <span className="shrink-0 rounded-full border border-solid border-line bg-surface-3 px-[7px] py-[2px] font-[family-name:var(--font-mono)] text-[10.5px] uppercase tracking-[0.04em] text-ink-4">{engine}</span>
      </div>

      {subtitle && (
        <span className="truncate text-sm text-ink-3">{subtitle}</span>
      )}

      <div className="flex-1" />

      {needsReconnect && (
        <div className="font-[family-name:var(--font-body)] text-[12px] font-medium text-warning">
          Reconnection required — click to fix
        </div>
      )}

      <div className="flex items-center gap-2.5 border-t border-x-0 border-b-0 border-solid border-line pt-2.5">
        <span className="flex-1 font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.04em] text-ink-4">
          {updated ? `updated ${updated}` : 'connected'}
        </span>
        <Button
          variant="danger"
          size="sm"
          onClick={handleRemove}
          disabled={busy}
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
    <div className="flex items-baseline gap-2">
      <span className="w-[100px] shrink-0 font-[family-name:var(--font-body)] text-[12px] text-ink-4">{label}</span>
      <span className="truncate font-[family-name:var(--font-mono)] text-[12px] text-ink">{value || '—'}</span>
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
        className="fixed inset-0 z-[70] bg-[rgba(0,0,0,0.18)]"
      />

      {/* Slide-in panel */}
      <div
        role="dialog"
        aria-label={`${spec?.label || connection.engine} connection details`}
        className="fixed top-0 right-0 bottom-0 z-[71] flex w-[min(400px,_92vw)] flex-col border-l border-y-0 border-r-0 border-solid border-line bg-surface font-[family-name:var(--font-body)] shadow-[-12px_0_40px_rgba(0,0,0,0.12)]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-x-0 border-t-0 border-solid border-line pt-[18px] px-5 pb-4">
          <span className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2">
            {spec?.logo_url
              ? <img src={spec.logo_url} alt="" className="h-[22px] w-[22px] object-contain" />
              : <span className="inline-flex text-ink-3">{Ico.database(18)}</span>
            }
          </span>
          <div className="min-w-0 flex-1">
            <div className="s-h3 truncate">
              {spec?.label || connection.engine}
            </div>
            <div className="mt-[1px] font-[family-name:var(--font-mono)] text-xs text-ink-4">
              {connection.name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[18px] leading-none text-ink-3"
          >×</button>
        </div>

        {/* Body */}
        <div className="scroll-clean flex-1 overflow-y-auto py-[18px] px-5">
          {loading ? (
            <div className="text-[13px] text-ink-4">Loading…</div>
          ) : (
            <>
              {/* Meta */}
              <div className="mb-5 flex flex-col gap-2 rounded-lg border border-solid border-line bg-surface-2 py-3 px-[14px]">
                <MetaRow label="Engine" value={connection.engine} />
                {saved?.updatedAt && <MetaRow label="Last updated" value={fmtDate(saved.updatedAt)} />}
                {saved?.createdAt && <MetaRow label="Connected" value={fmtDate(saved.createdAt)} />}
              </div>

              {/* Credentials */}
              {displayFields.length > 0 && (
                <>
                  <div className="mb-2 font-[family-name:var(--font-body)] text-xs font-semibold uppercase tracking-[0.05em] text-ink-3">
                    Credentials
                  </div>
                  <div className="mb-5 overflow-hidden rounded-lg border border-solid border-line">
                    {displayFields.map((f, i) => (
                      <div
                        key={f.key}
                        className={cn(
                          'flex items-center gap-2.5 bg-surface py-2.5 px-[14px]',
                          i < displayFields.length - 1 ? 'border-b border-x-0 border-t-0 border-solid border-line' : 'border-0',
                        )}
                      >
                        <span className="w-[120px] shrink-0 font-[family-name:var(--font-body)] text-[12px] font-medium text-ink-3">
                          {f.label}
                        </span>
                        <span
                          className={cn(
                            'flex-1 truncate font-[family-name:var(--font-mono)] text-[12px]',
                            (f.isSecret || !f.value) ? 'text-ink-4' : 'text-ink',
                            (!f.isSecret && !f.value) && 'italic',
                          )}
                        >
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
                  <div className="mb-2 font-[family-name:var(--font-body)] text-xs font-semibold uppercase tracking-[0.05em] text-ink-3">
                    Drive files
                  </div>
                  <div className="mb-5 flex flex-col gap-2.5 rounded-lg border border-solid border-line py-3 px-[14px]">
                    <div className="text-[12px] leading-normal text-ink-3">
                      This connection can only read files it created itself. Select any files below —
                      including several at once, or whole Shared Drives — to grant access to them too.
                    </div>
                    {pickerState.status === 'waiting' ? (
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Spinner className="text-ink-3" />
                        <span className="text-[12px] text-ink-3">
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
                        className="self-start"
                      >
                        Select files from Google Drive
                      </Button>
                    )}
                    {pickerState.status === 'error' && (
                      <div className="text-[12px] text-danger">{pickerState.reason}</div>
                    )}
                    {pickerState.status === 'done' && pickerState.failed?.length > 0 && (
                      <Alert variant="danger">
                        Google didn't actually grant access to {pickerState.failed.length === 1 ? 'this file' : 'these files'} —
                        try picking {pickerState.failed.length === 1 ? 'it' : 'them'} again:
                        <ul className="mt-1 mx-0 mb-0 pl-[18px]">
                          {pickerState.failed.map((f) => (
                            <li key={f.id}>{f.name} ({f.reason})</li>
                          ))}
                        </ul>
                      </Alert>
                    )}
                    {pickerState.status === 'done' && pickerState.files.length === 0 && (
                      <div className="text-[12px] italic text-ink-4">No files selected.</div>
                    )}
                    {pickerState.status === 'done' && pickerState.files.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[12px] text-ink-3">
                          Granted access to {pickerState.files.length} file{pickerState.files.length === 1 ? '' : 's'}:
                        </div>
                        {pickerState.files.map((f) => (
                          <a
                            key={f.id}
                            href={f.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 overflow-hidden rounded-md bg-surface-2 py-1 px-1.5 text-[12px] text-ink no-underline"
                          >
                            {f.iconUrl && <img src={f.iconUrl} alt="" className="h-3.5 w-3.5 shrink-0" />}
                            <span className="truncate">{f.name}</span>
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
        <div className="flex shrink-0 flex-col gap-2 border-t border-x-0 border-b-0 border-solid border-line py-3.5 px-5">
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
              className="w-full justify-center"
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
    <div className="scroll-clean flex flex-1 flex-col overflow-y-auto">
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
          icon={<span className="inline-flex text-ink-4">{Ico.link(32)}</span>}
          title="No apps connected yet"
          description={`Connectors shape how ${agentLabel} works with you. Hook up the apps and databases you already use, and ${agentLabel} will automate work there.`}
          action={<ConnectButton onClick={handleConnectNew} large />}
          style={{ flex: 1 }}
        />
      ) : (
        <div className="mt-[18px] grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5 pt-1.5 px-8 pb-[60px]">
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
