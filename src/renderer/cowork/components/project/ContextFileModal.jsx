// ContextFileModal — view + edit for any markdown file the user
// can open from the rail or the Memory page. Originally this only
// drove project context files (`anton.md` + anything under
// `.context/`); it has since been generalised so memory entries
// (rules, lessons, identity notes) can ride the same modal — the
// design language, keyboard handling, and edit↔view rhythm should
// feel identical regardless of where the file lives.
//
// Two ways to wire it up:
//
//   1. Project file mode (legacy): pass `projectName` + `filePath`,
//      the modal handles read/write/delete via the project files
//      API. `isAntonMd` (or the path matching
//      ANTON_PROJECT_INSTRUCTIONS_PATH) flips on the special anton.md
//      affordances (label, empty-state placeholder, undeletable).
//
//   2. Generic mode: pass `title` + `loader` (or `initialContent`)
//      + `saver` + optional `remover`. Used by the memory rail to
//      view + edit a memory file without dragging the project-file
//      API into a place that doesn't need it.
//
// Mode rules:
//   • If the file exists with content → opens in VIEW mode. User
//     clicks "Edit" to switch to a textarea.
//   • If the file is `anton.md` AND empty / missing → opens directly
//     in EDIT mode. There's nothing to read; the modal IS the
//     authoring surface. (`startInEditMode` overrides this.)
//   • Save commits and switches back to view mode.

import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import {
  readProjectFile,
  writeProjectFile,
  deleteProjectFile,
  ANTON_PROJECT_INSTRUCTIONS_PATH,
} from '../../api';
import { MarkdownContent } from '../markdown/MarkdownContent';

const FONT_BODY    = "var(--font-body, 'Inter', system-ui, sans-serif)";
const FONT_DISPLAY = "var(--font-display, 'Josefin Sans', system-ui, sans-serif)";
const FONT_MONO    = "var(--font-mono, 'JetBrains Mono', monospace)";

export default function ContextFileModal({
  open,
  // ── Project file mode ─────────────────────────────────────────
  projectName,
  filePath,        // project-relative path (instructions: ANTON_PROJECT_INSTRUCTIONS_PATH)
  isAntonMd,       // optional override; otherwise derived from filePath
  // ── Generic / shared ─────────────────────────────────────────
  title,           // overrides the header title (otherwise filePath / 'anton.md')
  subtitle,        // optional uppercase label after the title (e.g. "Project · acme")
  initialContent,  // optional preview from the listing — saves a fetch on open
  loader,          // optional async () => string. Falls back to readProjectFile.
  saver,           // optional async (content) => void. Falls back to writeProjectFile.
  remover,         // optional async () => void. `null` disables delete; otherwise
                   //   falls back to deleteProjectFile (anton.md is always undeletable).
  startInEditMode, // optional bool — overrides the "open in edit if empty" default.
  placeholder,     // optional textarea placeholder
  emptyMessage,    // optional message shown when content is empty + not editing
  dense,           // pass-through to MarkdownContent — smaller type for memory previews
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
  // Generic mode = caller wired up its own loader/saver and didn't
  // pass a project file context. Used to gate the anton-specific
  // empty-state default and the project-file fallback IO.
  const genericMode = typeof saver === 'function' || typeof loader === 'function';

  const headerTitle = title ?? (isAnton ? 'anton.md' : filePath);
  const headerSubtitle = subtitle ?? (isAnton ? 'Project instructions' : null);
  const editorPlaceholder = placeholder ?? (isAnton
    ? "Tell Anton how to work in this project — codebase conventions, output preferences, things to avoid…"
    : 'File contents');
  const emptyText = emptyMessage ?? (isAnton
    ? '(no instructions yet — click Edit to add some)'
    : '(empty file)');

  // Markdown files render with our chat MarkdownContent component so
  // headings, lists, code fences, tables, and links look the way they
  // do anywhere else in the app. Anything else (txt, json, yaml…)
  // falls back to a monospace `<pre>` with the raw bytes — beautifying
  // those would obscure the actual contents the user came to inspect.
  // The fallback ID for the modal-edit case (no filePath, e.g. memory
  // entries identified by relativePath through `title`) is "anton.md"
  // so memory rows still render markdown.
  const referencePath = filePath || title || '';
  const isMarkdown = /\.md$/i.test(referencePath) || referencePath === ''
    || isAnton;

  // Load on open. Anton.md is special-cased server-side: the read
  // endpoint returns an empty body when the file doesn't exist yet,
  // so we always get a clean string here.
  useEffect(() => {
    if (!open) return;
    if (!genericMode && (!filePath || !projectName)) return;
    let cancelled = false;
    setError('');
    if (initialContent != null) {
      // Hot path — caller had the content already (from a recent
      // fetch / a draft). Skip the round trip.
      setContent(initialContent);
      setDraft(initialContent);
      // anton.md with empty content → straight to edit mode (the
      // user opened it to author it). Other files default to view.
      setEditing(startInEditMode ?? (isAnton && !initialContent.trim()));
      return undefined;
    }
    setLoading(true);
    const read = typeof loader === 'function'
      ? loader()
      : readProjectFile(projectName, filePath).then((res) => res?.content || '');
    Promise.resolve(read)
      .then((body) => {
        if (cancelled) return;
        const text = typeof body === 'string' ? body : (body?.content || '');
        setContent(text);
        setDraft(text);
        setEditing(startInEditMode ?? (isAnton && !text.trim()));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Could not read file');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, filePath, projectName, initialContent, isAnton, loader, genericMode, startInEditMode]);

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
      if (typeof saver === 'function') {
        await saver(draft);
      } else {
        await writeProjectFile(projectName, filePath, draft);
      }
      setContent(draft);
      setEditing(false);
      onChanged?.({ path: filePath, content: draft });
    } catch (e) {
      setError(e?.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  // Delete is hidden when the caller passes `remover === null` OR
  // when this is anton.md (always-present project instructions).
  const canDelete = remover !== null && !isAnton;

  const handleDelete = async () => {
    if (!canDelete) return;
    const confirmTarget = title || filePath || 'this file';
    if (!window.confirm(`Delete ${confirmTarget}? This can't be undone.`)) return;
    setBusy(true);
    setError('');
    try {
      if (typeof remover === 'function') {
        await remover();
      } else {
        await deleteProjectFile(projectName, filePath);
      }
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
          // FIXED height — not maxHeight. Toggling between view and
          // edit must feel like the same modal, just with the body
          // swapped, so the container size has to stay constant. The
          // textarea + preview inside both `flex: 1` to fill this
          // height identically (no jump-on-cancel).
          height: 'min(720px, 88vh)',
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
        }}>
          <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h2 style={{
              margin: 0,
              fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 600,
              letterSpacing: '-0.005em', color: 'var(--ink)',
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{headerTitle}</h2>
            {headerSubtitle && (
              <span style={{
                fontFamily: FONT_MONO, fontSize: 10.5, color: 'var(--ink-4)',
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>{headerSubtitle}</span>
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

        {/* Body is a flex column so the textarea / pre below can both
            `flex: 1` and fill the same vertical space identically.
            The body itself doesn't scroll — content scrolls inside
            the textarea or the pre. */}
        <div style={{
          flex: 1, minHeight: 0,
          padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {loading && (
            <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</div>
          )}
          {error && (
            <div style={{
              padding: '10px 12px', borderRadius: 7,
              background: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
              color: 'var(--danger)', fontSize: 13,
              flexShrink: 0,
            }}>{error}</div>
          )}
          {!loading && (editing ? (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={editorPlaceholder}
              spellCheck={false}
              disabled={busy}
              style={{
                flex: 1, minHeight: 0,
                width: '100%',
                padding: '12px 14px', borderRadius: 8,
                background: 'var(--surface-2)',
                // Transparent border — content panel blends into the
                // modal body instead of nesting a hard rectangle. The
                // border is kept (rather than removed) so the panel
                // keeps its layout footprint identical to the
                // markdown viewer below; both must size identically
                // for the view↔edit swap to feel seamless.
                border: '1px solid transparent',
                color: 'var(--ink)',
                fontFamily: FONT_MONO, fontSize: 13, lineHeight: 1.55,
                outline: 'none',
                resize: 'none',
                boxSizing: 'border-box',
              }}
            />
          ) : isMarkdown ? (
            // Beautiful markdown render for `.md` files (anton.md,
            // memory entries, anything else markdown-shaped). The
            // outer container handles the panel chrome + scroll; the
            // MarkdownContent component just lays out the body.
            <div style={{
              flex: 1, minHeight: 0,
              padding: '14px 18px',
              background: 'var(--surface-2)',
              border: '1px solid transparent',
              borderRadius: 8,
              overflowY: 'auto',
            }}>
              {content
                ? <MarkdownContent text={content} id={`ctx-${referencePath || 'doc'}`} complete dense={dense} />
                : <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>{emptyText}</span>}
            </div>
          ) : (
            <pre style={{
              flex: 1, minHeight: 0,
              margin: 0,
              padding: '14px 16px',
              background: 'var(--surface-2)',
              border: '1px solid transparent',
              borderRadius: 8,
              fontFamily: FONT_MONO, fontSize: 13, lineHeight: 1.55,
              color: 'var(--ink-2)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowY: 'auto',
            }}>{content || emptyText}</pre>
          ))}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8,
          padding: '12px 18px',
          background: 'var(--surface)',
        }}>
          <div>
            {canDelete && !editing && !loading && (
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
              >
                {busy ? 'Saving…' : 'Save'}
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
