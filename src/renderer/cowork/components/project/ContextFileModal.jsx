// ContextFileModal — view + edit for a project context file
// (`anton.md` + anything else under the project's .context dir).
//
// Mode rules:
//   • If the file exists with content → opens in VIEW mode. User
//     clicks "Edit" to switch to a textarea.
//   • If the file is `anton.md` AND empty / missing → opens directly
//     in EDIT mode. There's nothing to read; the modal IS the
//     authoring surface.
//   • Save commits via PUT and switches back to view mode.
//
// Keeping the editor inside a modal (instead of inline in the rail)
// matches the existing MemoryModal pattern; both surfaces feel like
// the same family of "open a file, look at it, maybe edit it".

import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import {
  readProjectFile,
  writeProjectFile,
  deleteProjectFile,
  ANTON_PROJECT_INSTRUCTIONS_PATH,
} from '../../api';

const FONT_BODY    = "var(--font-body, 'Inter', system-ui, sans-serif)";
const FONT_DISPLAY = "var(--font-display, 'Josefin Sans', system-ui, sans-serif)";
const FONT_MONO    = "var(--font-mono, 'JetBrains Mono', monospace)";

export default function ContextFileModal({
  open,
  projectName,
  filePath,        // project-relative path (instructions: ANTON_PROJECT_INSTRUCTIONS_PATH)
  initialContent,  // optional preview from the listing — saves a fetch on open
  isAntonMd,       // optional override; otherwise derived from filePath
  onClose,
  onChanged,       // called after a successful save / delete so callers can refresh
}) {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef(null);

  const isAnton = !!(isAntonMd ?? (filePath === ANTON_PROJECT_INSTRUCTIONS_PATH));

  // Load on open. Anton.md is special-cased server-side: the read
  // endpoint returns an empty body when the file doesn't exist yet,
  // so we always get a clean string here.
  useEffect(() => {
    if (!open || !filePath || !projectName) return;
    let cancelled = false;
    setError('');
    if (initialContent != null) {
      // Hot path — caller had the content already (from a recent
      // fetch / a draft). Skip the round trip.
      setContent(initialContent);
      setDraft(initialContent);
      // anton.md with empty content → straight to edit mode (the
      // user opened it to author it).
      setEditing(isAnton && !initialContent.trim());
      return undefined;
    }
    setLoading(true);
    readProjectFile(projectName, filePath)
      .then((res) => {
        if (cancelled) return;
        const body = res?.content || '';
        setContent(body);
        setDraft(body);
        setEditing(isAnton && !body.trim());
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Could not read file');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, filePath, projectName, initialContent, isAnton]);

  // Esc closes when not busy.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  // Focus the textarea when entering edit mode.
  useEffect(() => {
    if (!editing) return;
    const id = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [editing]);

  if (!open) return null;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await writeProjectFile(projectName, filePath, draft);
      setContent(draft);
      setEditing(false);
      onChanged?.({ path: filePath, content: draft });
    } catch (e) {
      setError(e?.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (isAnton) return;  // anton.md is permanent — always-present in the listing
    if (!window.confirm(`Delete ${filePath}? This can't be undone.`)) return;
    setBusy(true);
    setError('');
    try {
      await deleteProjectFile(projectName, filePath);
      onChanged?.({ path: filePath, deleted: true });
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Could not delete');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 92,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        WebkitAppRegion: 'no-drag',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 92vw)',
          maxHeight: 'min(720px, 88vh)',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(15,16,17,0.30)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: FONT_BODY,
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid var(--line)',
        }}>
          <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h2 style={{
              margin: 0,
              fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 600,
              letterSpacing: '-0.005em', color: 'var(--ink)',
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{isAnton ? 'anton.md' : filePath}</h2>
            {isAnton && (
              <span style={{
                fontFamily: FONT_MONO, fontSize: 10.5, color: 'var(--ink-4)',
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>Project instructions</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {!editing && !loading && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                title="Edit"
                style={{
                  cursor: 'pointer',
                  background: 'transparent', border: '1px solid var(--line)',
                  color: 'var(--ink-2)',
                  padding: '6px 12px', borderRadius: 6,
                  fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
                }}
              >Edit</button>
            )}
            <button
              type="button"
              onClick={() => !busy && onClose?.()}
              title="Close"
              style={{
                cursor: busy ? 'not-allowed' : 'pointer',
                background: 'transparent', border: 0,
                color: 'var(--ink-3)',
                width: 28, height: 28, borderRadius: 6,
                display: 'inline-grid', placeItems: 'center',
                fontSize: 18, lineHeight: 1,
              }}
            >×</button>
          </div>
        </div>

        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          padding: '16px 18px',
        }}>
          {loading && (
            <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</div>
          )}
          {error && (
            <div style={{
              padding: '10px 12px', borderRadius: 7,
              background: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
              color: 'var(--danger)', fontSize: 13, marginBottom: 10,
            }}>{error}</div>
          )}
          {!loading && (editing ? (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={isAnton
                ? "Tell Anton how to work in this project — codebase conventions, output preferences, things to avoid…"
                : "File contents"}
              spellCheck={false}
              disabled={busy}
              style={{
                width: '100%', minHeight: 320, maxHeight: '60vh',
                padding: '12px 14px', borderRadius: 8,
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
                color: 'var(--ink)',
                fontFamily: FONT_MONO, fontSize: 13, lineHeight: 1.55,
                outline: 'none',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          ) : (
            <pre style={{
              margin: 0,
              padding: '14px 16px',
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              fontFamily: FONT_MONO, fontSize: 13, lineHeight: 1.55,
              color: 'var(--ink-2)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              minHeight: 120,
            }}>{content || (isAnton
              ? '(no instructions yet — click Edit to add some)'
              : '(empty file)')}</pre>
          ))}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8,
          padding: '12px 18px',
          borderTop: '1px solid var(--line)',
          background: 'var(--surface)',
        }}>
          <div>
            {!isAnton && !editing && !loading && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                style={{
                  cursor: busy ? 'not-allowed' : 'pointer',
                  background: 'transparent', border: 0,
                  color: 'var(--danger)',
                  padding: '7px 0', borderRadius: 7,
                  fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
                  opacity: busy ? 0.5 : 1,
                }}
              >Delete</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  // Cancel edit — restore the persisted content. If
                  // anton.md is still empty after cancel, kick the
                  // modal back to its no-content view.
                  setDraft(content);
                  setEditing(false);
                }}
                disabled={busy}
                style={{
                  cursor: busy ? 'not-allowed' : 'pointer',
                  background: 'transparent', border: 0,
                  color: 'var(--ink-3)',
                  padding: '7px 14px', borderRadius: 7,
                  fontFamily: FONT_BODY, fontSize: 13, fontWeight: 500,
                }}
              >Cancel</button>
            )}
            {editing && (
              <button
                type="button"
                className="btn-primary"
                onClick={save}
                disabled={busy}
                style={{ letterSpacing: '0.04em' }}
              >
                {busy ? 'Saving…' : 'SAVE'}
              </button>
            )}
            {!editing && !loading && (
              <button
                type="button"
                onClick={() => onClose?.()}
                style={{
                  cursor: 'pointer',
                  background: 'transparent', border: 0,
                  color: 'var(--ink-3)',
                  padding: '7px 14px', borderRadius: 7,
                  fontFamily: FONT_BODY, fontSize: 13, fontWeight: 500,
                }}
              >Close</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
