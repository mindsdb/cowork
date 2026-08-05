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
import { Alert, Button, Field, Input, Textarea } from '../ui';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import {
  createProject,
  uploadProjectFiles,
  writeProjectFile,
  ANTON_PROJECT_INSTRUCTIONS_PATH,
} from '../../api';

const FONT_BODY    = "var(--font-body, 'Inter', system-ui, sans-serif)";
const FONT_DISPLAY = "var(--font-display, 'Inter', system-ui, sans-serif)";
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
    const id = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Esc + backdrop dismissal are <Modal>'s job (suppressed while busy via
  // closeOnEsc / closeOnBackdrop). The name field auto-focuses on open.

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

      // 3) Upload files in one multipart request. All-or-nothing per
      //    file — server returns a per-file result list we ignore for
      //    now (could surface partial failures in a toast later).
      if (files.length) {
        try {
          await uploadProjectFiles(finalName, files);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[new-project] uploads failed', e);
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

  const removeFile = (i) => setFiles((prev) => prev.filter((_, j) => j !== i));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      width="min(560px, 92vw)"
      maxHeight="min(680px, 88vh)"
      labelledBy="new-project-title"
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
    >
      <ModalHeader
        id="new-project-title"
        title="Start a new project"
        onClose={busy ? undefined : onClose}
      />
      <ModalBody padding="16px 18px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Project name">
            <Input
              ref={nameRef}
              value={name}
              onChange={(v) => setName(v)}
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
          </Field>

          <Field
            label="Instructions"
            optional
            help={
              <>
                Saved as <code style={{
                  fontFamily: FONT_MONO,
                  background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3,
                  color: 'var(--ink-3)',
                }}>.anton/anton.md</code>
              </>
            }
          >
            <Textarea
              value={instructions}
              onChange={(v) => setInstructions(v)}
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
          </Field>

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
            <Alert variant="danger">{error}</Alert>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <Button
          variant="subtle"
          onClick={() => !busy && onClose?.()}
          disabled={busy}
        >Cancel</Button>
        <Button
          variant="primary"
          onClick={create}
          disabled={busy || !name.trim()}
        >
          {!busy && Ico.plus(14)}
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
