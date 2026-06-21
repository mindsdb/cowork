/* Inline file/folder picker, rendered inside the streaming assistant turn when
 * the agent's `select_path` tool needs the user to choose a path.
 *
 * Two modes:
 *   • pick   — disambiguate concrete options the agent already found.
 *   • browse — navigate the filesystem from a starting folder and select.
 *
 * The choice is POSTed back into the paused turn (the agent resumes with it as
 * a tool result — never a new user message). The picker collapses to a one-line
 * confirmation the instant a choice is made. A fresh request remounts via
 * `key={requestId}`, so local state resets without an effect. */

import { useEffect, useState } from 'react';
import { submitPathSelection, listDirectory } from '../api';
import { host } from '../../platform/host';

const MONO = "'JetBrains Mono', monospace";
const BODY = "'Inter', system-ui, sans-serif";

function Glyph({ kind }) {
  const isFolder = kind === 'folder';
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, opacity: 0.75 }} aria-hidden="true"
    >
      {isFolder ? (
        <path d="M1.75 3.5h4l1.5 1.75h7v6.25a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1V3.5Z" />
      ) : (
        <>
          <path d="M9 1.75H4.25a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V5.5L9 1.75Z" />
          <path d="M9 1.75V5.5h3.75" />
        </>
      )}
    </svg>
  );
}

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
  background: 'transparent', border: 'none', borderRadius: 8, padding: '7px 8px',
  cursor: 'pointer', color: 'var(--ink)', font: 'inherit',
};
const hoverOn = (e) => { e.currentTarget.style.background = 'var(--surface-2)'; };
const hoverOff = (e) => { e.currentTarget.style.background = 'transparent'; };
const labelStyle = {
  fontFamily: MONO, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden',
  textOverflow: 'ellipsis', flex: 1, minWidth: 0,
};

function Row({ kind, label, detail, onClick, title }) {
  return (
    <button type="button" onClick={onClick} onMouseEnter={hoverOn} onMouseLeave={hoverOff} style={rowStyle}>
      <Glyph kind={kind} />
      <span style={labelStyle} title={title || label}>{label}</span>
      {detail ? (
        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-4)', flexShrink: 0 }}>{detail}</span>
      ) : null}
    </button>
  );
}

function basename(p) {
  if (!p) return '/';
  const parts = String(p).replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || '/';
}

/** Browse mode on Electron — a button that opens the native OS picker
 *  (Finder/Explorer), like Claude Cowork's "Choose folder". No in-app tree. */
function NativeBrowse({ request, onChoose }) {
  const [busy, setBusy] = useState(false);
  const label = request.kind === 'file' ? 'Choose file' : 'Choose folder';

  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await host.pickPath({
        kind: request.kind,
        title: request.prompt,
        defaultPath: request.root || undefined,
      });
      // On cancel we stay on the card so the user can retry or hit Cancel.
      if (res?.ok && res.path) onChoose(res.path, basename(res.path));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      style={{
        alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8,
        border: '1px solid var(--line)', background: 'var(--surface-2)', borderRadius: 8,
        padding: '8px 14px', cursor: busy ? 'default' : 'pointer',
        fontFamily: BODY, fontSize: 13, fontWeight: 500, color: 'var(--ink)',
      }}
    >
      <Glyph kind="folder" />
      {busy ? 'Opening…' : label}
    </button>
  );
}

/** Pick mode — a flat list of the agent's candidates. */
function PickBody({ request, onChoose }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 260, overflowY: 'auto', margin: '0 -4px' }}>
      {(request.options || []).map((opt) => (
        <Row
          key={opt.value}
          kind={opt.kind}
          label={opt.label}
          detail={opt.detail}
          title={opt.value}
          onClick={() => onChoose(opt.value, opt.label)}
        />
      ))}
    </div>
  );
}

/** Browse mode — navigate the filesystem and select a file or folder. */
function BrowseBody({ request, onChoose }) {
  const [cwd, setCwd] = useState(request.root || '');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listDirectory(cwd, { kind: request.kind })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Cannot read this folder'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, request.kind]);

  const here = data?.path || cwd;
  const canPickFolder = request.kind !== 'file';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <button
          type="button"
          onClick={() => data?.parent && setCwd(data.parent)}
          disabled={!data?.parent}
          title="Up one level"
          style={{
            border: '1px solid var(--line)', background: 'transparent', borderRadius: 6,
            padding: '2px 7px', cursor: data?.parent ? 'pointer' : 'default',
            color: 'var(--ink-3)', fontFamily: MONO, fontSize: 12, flexShrink: 0,
            opacity: data?.parent ? 1 : 0.4,
          }}
        >↑</button>
        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl' }} title={here}>
          {here}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto', margin: '0 -4px', minHeight: 40 }}>
        {loading && <div style={{ padding: '8px', fontFamily: MONO, fontSize: 11, color: 'var(--ink-4)' }}>Loading…</div>}
        {error && !loading && <div style={{ padding: '8px', fontFamily: MONO, fontSize: 11, color: 'var(--ink-4)' }}>{error}</div>}
        {!loading && !error && (data?.entries || []).length === 0 && (
          <div style={{ padding: '8px', fontFamily: MONO, fontSize: 11, color: 'var(--ink-4)' }}>Empty folder</div>
        )}
        {!loading && !error && (data?.entries || []).map((entry) => (
          <Row
            key={entry.path}
            kind={entry.is_dir ? 'folder' : 'file'}
            label={entry.name}
            title={entry.path}
            onClick={() => {
              if (entry.is_dir) setCwd(entry.path);
              else onChoose(entry.path, entry.name); // file pick (kind file/any)
            }}
          />
        ))}
        {data?.truncated && (
          <div style={{ padding: '6px 8px', fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4)' }}>
            …more items not shown
          </div>
        )}
      </div>

      {canPickFolder && (
        <button
          type="button"
          onClick={() => onChoose(here, basename(here))}
          style={{
            alignSelf: 'flex-start', border: '1px solid var(--line)', background: 'var(--surface-2)',
            borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
            fontFamily: BODY, fontSize: 12, fontWeight: 500, color: 'var(--ink)',
          }}
        >
          Use this folder
        </button>
      )}
    </>
  );
}

export function PathSelector({ request, conversationId }) {
  // null while choosing; { label } after a pick; { cancelled: true } on dismiss.
  const [resolved, setResolved] = useState(null);
  const requestId = request?.requestId;
  const isBrowse = request?.mode === 'browse';

  const choose = (value, label) => {
    if (resolved) return;
    setResolved({ label });
    submitPathSelection(conversationId, requestId, value);
  };
  const dismiss = () => {
    if (resolved) return;
    setResolved({ cancelled: true });
    submitPathSelection(conversationId, requestId, null);
  };

  if (resolved) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 11, color: 'var(--ink-4)', padding: '2px 0' }}>
        <span aria-hidden="true">{resolved.cancelled ? '⊘' : '✓'}</span>
        <span>{resolved.cancelled ? 'Dismissed' : `Selected ${resolved.label}`}</span>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={request?.prompt || 'Select a file or folder'}
      style={{
        border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 12,
        padding: 12, maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <div style={{ fontFamily: BODY, fontSize: 13, color: 'var(--ink-2)', fontWeight: 500 }}>
        {request?.prompt || 'Which one did you mean?'}
      </div>

      {isBrowse
        ? (host.canPickPath
            ? <NativeBrowse request={request} onChoose={choose} />
            : <BrowseBody request={request} onChoose={choose} />)
        : <PickBody request={request} onChoose={choose} />}

      <button
        type="button"
        onClick={dismiss}
        style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', padding: '2px 0', cursor: 'pointer', fontFamily: MONO, fontSize: 11, color: 'var(--ink-4)' }}
      >
        {isBrowse ? 'Cancel' : 'None of these'}
      </button>
    </div>
  );
}
