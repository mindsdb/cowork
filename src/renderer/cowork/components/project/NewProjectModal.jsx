// "Start a new project" modal.
//
// Replaces the inline-edit dashed card on the projects page. Owns
// the full create flow:
//   1. Validate the name (server sanitises + dedupes; we just guard
//      empty / whitespace).
//   2. POST /v1/projects to create the folder.
//   3. If the user supplied instructions text, PUT it at
//      ANTON_PROJECT_INSTRUCTIONS_PATH (`.anton/anton.md`).
//   4. If files are queued, upload them in one multipart request.
//
// Failure handling: each step that touches the server is independent
// — we show a status line if a step fails but don't roll back the
// already-completed steps. The user can finish the rest manually.

import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import {
  createProject,
  uploadProjectFilesWithProgress,
  writeProjectFile,
  UploadAbortedError,
  ANTON_PROJECT_INSTRUCTIONS_PATH,
} from '../../api';

const FONT_BODY    = "var(--font-body, 'Inter', system-ui, sans-serif)";
const FONT_DISPLAY = "var(--font-display, 'Josefin Sans', system-ui, sans-serif)";
const FONT_MONO    = "var(--font-mono, 'JetBrains Mono', monospace)";

function FileList({ files, onRemove }) {
  if (!files.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      {files.map((f, i) => (
        <div
          key={`${f.name}-${i}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-2)',
          }}
        >
          <span style={{ display: 'inline-flex', color: 'var(--ink-3)' }}>{Ico.doc(13)}</span>
          <span style={{
            flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{f.name}</span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: 'var(--ink-4)' }}>
            {Math.ceil(f.size / 1024)} KB
          </span>
          <button
            type="button"
            onClick={() => onRemove(i)}
            title="Remove"
            aria-label="Remove"
            style={{
              background: 'transparent', border: 0, padding: 0,
              color: 'var(--ink-4)', cursor: 'pointer',
              display: 'inline-grid', placeItems: 'center',
              width: 20, height: 20, borderRadius: 4,
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--danger)'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-4)'; }}
          >×</button>
        </div>
      ))}
    </div>
  );
}

export default function NewProjectModal({ open, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  // Upload progress for the batch: null when not uploading, 0..1 while bytes
  // are in flight, null again ("Saving files…") once sent and the server is
  // writing. `uploading` gates the progress UI and turns Cancel into Stop.
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const uploadAbortRef = useRef(null);
  const nameRef = useRef(null);
  const fileInputRef = useRef(null);

  // Reset everything when the modal opens — `open` flipping false→true
  // should always present a clean form.
  useEffect(() => {
    if (!open) return;
    setName('');
    setInstructions('');
    setFiles([]);
    setBusy(false);
    setError('');
    setDragActive(false);
    setUploading(false);
    setUploadProgress(null);
    uploadAbortRef.current = null;
    const id = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Esc closes (only when not busy — letting a half-completed create
  // run to its terminal state avoids orphaned partial uploads).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const addFiles = (incoming) => {
    if (!incoming || !incoming.length) return;
    // Dedupe on name+size — common case is the user re-dragging the
    // same selection; merging without dedupe creates dupes.
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}::${f.size}`));
      const next = [...prev];
      for (const f of incoming) {
        const key = `${f.name}::${f.size}`;
        if (!seen.has(key)) { next.push(f); seen.add(key); }
      }
      return next;
    });
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    addFiles(e.dataTransfer?.files);
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Project name is required.');
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      // 1) Create the folder. Server sanitises + dedupes — `result.name`
      //    is the canonical name the rest of the steps must use.
      const result = await createProject(trimmed);
      const finalName = result?.name || trimmed;

      // 2) Write instructions if the user typed any. Use the final
      //    (post-sanitisation) project name.
      const trimmedInstr = (instructions || '').trim();
      if (trimmedInstr) {
        try {
          await writeProjectFile(finalName, ANTON_PROJECT_INSTRUCTIONS_PATH, trimmedInstr);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[new-project] writing anton.md failed', e);
        }
      }

      // 3) Upload files in one multipart request, with a determinate
      //    progress bar + cancel. The project already exists, so a canceled
      //    or failed upload is non-fatal — we finish the create and let the
      //    user add files later (same lenient handling as before).
      if (files.length) {
        const controller = new AbortController();
        uploadAbortRef.current = controller;
        setUploading(true);
        setUploadProgress(0);
        try {
          await uploadProjectFilesWithProgress(finalName, files, {
            signal: controller.signal,
            onProgress: (frac) => setUploadProgress(frac),
          });
        } catch (e) {
          if (!(e?.aborted || e instanceof UploadAbortedError)) {
            // eslint-disable-next-line no-console
            console.warn('[new-project] uploads failed', e);
          }
        } finally {
          setUploading(false);
          setUploadProgress(null);
          uploadAbortRef.current = null;
        }
      }

      onCreated?.(result);
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Could not create project.');
    } finally {
      setBusy(false);
    }
  };

  // Stop an in-flight upload (the project itself is already created).
  const cancelUpload = () => {
    const c = uploadAbortRef.current;
    if (c) { try { c.abort(); } catch {} }
  };

  const removeFile = (i) => setFiles((prev) => prev.filter((_, j) => j !== i));

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
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
          width: 'min(560px, 92vw)',
          maxHeight: 'min(680px, 88vh)',
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
          padding: '16px 18px',
          borderBottom: '1px solid var(--line)',
        }}>
          <h2 style={{
            margin: 0,
            fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600,
            letterSpacing: '-0.005em', color: 'var(--ink)',
          }}>Start a new project</h2>
          <button
            type="button"
            onClick={() => !busy && onClose?.()}
            disabled={busy}
            title="Close"
            style={{
              cursor: busy ? 'not-allowed' : 'pointer',
              background: 'transparent', border: 0,
              color: 'var(--ink-3)',
              width: 28, height: 28, borderRadius: 6,
              display: 'inline-grid', placeItems: 'center',
              fontSize: 18, lineHeight: 1,
              opacity: busy ? 0.5 : 1,
            }}
          >×</button>
        </div>

        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{
              fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600,
            }}>Project name</span>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="acme-engineering"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); create(); }
              }}
              style={{
                padding: '9px 11px', borderRadius: 7,
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
                color: 'var(--ink)',
                fontFamily: FONT_BODY, fontSize: 13.5,
                outline: 'none',
              }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{
              fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600,
            }}>Instructions <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink-4)', fontFamily: FONT_BODY, fontWeight: 400 }}>(optional)</span></span>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Tell the agent how to work in this project — codebase conventions, output preferences, things to avoid…"
              rows={5}
              disabled={busy}
              spellCheck={false}
              style={{
                padding: '9px 11px', borderRadius: 7,
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
                color: 'var(--ink)',
                fontFamily: FONT_BODY, fontSize: 13, lineHeight: 1.5,
                outline: 'none',
                resize: 'vertical',
                minHeight: 80, maxHeight: 220,
              }}
            />
            <span style={{
              fontFamily: FONT_MONO, fontSize: 10.5, color: 'var(--ink-4)',
            }}>
              Saved as <code style={{
                fontFamily: FONT_MONO,
                background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3,
                color: 'var(--ink-3)',
              }}>.anton/anton.md</code>
            </span>
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{
              fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600,
            }}>Files <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink-4)', fontFamily: FONT_BODY, fontWeight: 400 }}>(optional)</span></span>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              onClick={() => !busy && fileInputRef.current?.click()}
              style={{
                padding: '22px 16px',
                borderRadius: 9,
                background: dragActive
                  ? 'color-mix(in srgb, var(--accent) 8%, var(--surface-2))'
                  : 'var(--surface-2)',
                border: `1px dashed ${dragActive ? 'var(--accent)' : 'var(--line-2)'}`,
                color: 'var(--ink-3)',
                fontFamily: FONT_BODY, fontSize: 13,
                textAlign: 'center',
                cursor: busy ? 'not-allowed' : 'pointer',
                transition: 'border-color 120ms ease, background 120ms ease, color 120ms ease',
              }}
            >
              <div style={{ display: 'inline-flex', color: 'var(--ink-3)', marginBottom: 8 }}>
                {Ico.upload?.(20) || Ico.plus(20)}
              </div>
              <div style={{ fontWeight: 500, color: 'var(--ink-2)' }}>
                Drop files here or <span style={{ color: 'var(--accent)' }}>click to browse</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 4 }}>
                Reference docs, schemas, examples — anything the agent should know about.
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                // Snapshot before clearing `value`: clearing empties the live
                // FileList, and React runs the setState updater after this
                // handler returns — so passing FileList alone would add nothing.
                const picked = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = '';
                addFiles(picked);
              }}
            />
            <FileList files={files} onRemove={removeFile} />
          </div>

          {error && (
            <div style={{
              padding: '10px 12px', borderRadius: 7,
              background: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
              color: 'var(--danger)', fontSize: 13,
            }}>{error}</div>
          )}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: 8,
          padding: '12px 18px',
          borderTop: '1px solid var(--line)',
          background: 'var(--surface)',
        }}>
          {uploading && (
            <div style={{
              flex: 1, minWidth: 0,
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <span style={{
                fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-3)',
              }}>
                {typeof uploadProgress === 'number'
                  ? `Uploading files… ${Math.round(Math.min(1, Math.max(0, uploadProgress)) * 100)}%`
                  : 'Saving files…'}
              </span>
              <span
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                {...(typeof uploadProgress === 'number'
                  ? { 'aria-valuenow': Math.round(uploadProgress * 100) }
                  : {})}
                style={{
                  display: 'block', height: 3, borderRadius: 999, overflow: 'hidden',
                  background: 'color-mix(in srgb, var(--accent) 22%, transparent)',
                }}
              >
                <span style={{
                  display: 'block', height: '100%',
                  width: typeof uploadProgress === 'number'
                    ? `${Math.round(Math.min(1, Math.max(0, uploadProgress)) * 100)}%`
                    : '100%',
                  background: 'var(--accent)',
                  transition: 'width .18s ease',
                  opacity: typeof uploadProgress === 'number' ? 1 : 0.6,
                }} />
              </span>
            </div>
          )}
          <button
            type="button"
            // While uploading this becomes "Stop upload" (the project is
            // already created — we just abort the file transfer). Otherwise
            // it's the quiet text "Cancel" that closes the modal.
            onClick={() => (uploading ? cancelUpload() : (!busy && onClose?.()))}
            disabled={busy && !uploading}
            style={{
              cursor: (busy && !uploading) ? 'not-allowed' : 'pointer',
              background: 'transparent', border: 0,
              color: 'var(--ink-3)',
              padding: '7px 14px', borderRadius: 7,
              fontFamily: FONT_BODY, fontSize: 13, fontWeight: 500,
              opacity: (busy && !uploading) ? 0.5 : 1,
            }}
          >{uploading ? 'Stop upload' : 'Cancel'}</button>
          <button
            type="button"
            className="btn-primary"
            onClick={create}
            disabled={busy || !name.trim()}
            style={{ letterSpacing: '0.04em' }}
          >
            {busy ? 'Creating…' : 'CREATE'}
          </button>
        </div>
      </div>
    </div>
  );
}
