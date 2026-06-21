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

import { useState } from 'react';
import { submitPathSelection } from '../api';
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

/** Browse mode on Electron — buttons that open the native OS picker
 *  (Finder/Explorer), like Claude Cowork's "Choose folder". */
function NativeBrowse({ request, onChoose }) {
  const [busy, setBusy] = useState(false);

  const open = async (kind) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await host.pickPath({
        kind,
        title: request.prompt,
        defaultPath: request.root || undefined,
      });
      // On cancel we stay on the card so the user can retry or hit Cancel.
      if (res?.ok && res.path) await onChoose(res.path, basename(res.path));
    } finally {
      setBusy(false);
    }
  };

  const actions = request.kind === 'any'
    ? [
        { kind: 'file', label: 'Choose file' },
        { kind: 'folder', label: 'Choose folder' },
      ]
    : [{ kind: request.kind === 'file' ? 'file' : 'folder', label: request.kind === 'file' ? 'Choose file' : 'Choose folder' }];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {actions.map((action) => (
        <button
          key={action.kind}
          type="button"
          onClick={() => open(action.kind)}
          disabled={busy}
          style={{
            alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8,
            border: '1px solid var(--line)', background: 'var(--surface-2)', borderRadius: 8,
            padding: '8px 14px', cursor: busy ? 'default' : 'pointer',
            fontFamily: BODY, fontSize: 13, fontWeight: 500, color: 'var(--ink)',
          }}
        >
          <Glyph kind={action.kind} />
          {busy ? 'Opening…' : action.label}
        </button>
      ))}
    </div>
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

export function PathSelector({ request, conversationId }) {
  // null while choosing; { label } after a pick; { cancelled: true } on dismiss.
  const [resolved, setResolved] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const requestId = request?.requestId;
  const isBrowse = request?.mode === 'browse';

  const submit = async (value, nextResolved) => {
    if (resolved || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitPathSelection(conversationId, requestId, value);
      setResolved(nextResolved);
    } catch (err) {
      setError(err?.message || 'Could not submit selection.');
    } finally {
      setSubmitting(false);
    }
  };
  const choose = async (value, label) => {
    await submit(value, { label });
  };
  const dismiss = () => {
    submit(null, { cancelled: true });
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

      {host.canPickPath
        ? (isBrowse
            ? <NativeBrowse request={request} onChoose={choose} />
            : <PickBody request={request} onChoose={choose} />)
        : (
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-4)', padding: '2px 0' }}>
              Desktop app required
            </div>
          )}

      {error ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--danger, #b42318)' }}>
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={dismiss}
        disabled={submitting}
        style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', padding: '2px 0', cursor: 'pointer', fontFamily: MONO, fontSize: 11, color: 'var(--ink-4)' }}
      >
        {submitting ? 'Submitting…' : (isBrowse ? 'Cancel' : 'None of these')}
      </button>
    </div>
  );
}
