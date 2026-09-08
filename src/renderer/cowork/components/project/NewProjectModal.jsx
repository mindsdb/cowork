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
import { Alert, Button, Field, Input, Textarea, Tooltip } from '../ui';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import {
  createProject,
  uploadProjectFiles,
  writeProjectFile,
  ANTON_PROJECT_INSTRUCTIONS_PATH,
} from '../../api';

// Kept for the Input/Textarea `style` props below: those carry the
// `.field-input` globals class (which itself declares padding/border/bg), so
// the per-field overrides must stay inline to win the cascade tie.
const FONT_BODY = "var(--font-body, 'Inter', system-ui, sans-serif)";

function FileList({ files, onRemove }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-col gap-1 mt-2">
      {files.map((f, i) => (
        <div
          key={`${f.name}-${i}`}
          className="flex items-center gap-2 py-[6px] px-[10px] rounded-[6px] bg-surface-2 border border-solid border-line font-[family-name:var(--font-body)] text-sm text-ink-2"
        >
          <span className="inline-flex text-ink-3">{Ico.doc(13)}</span>
          <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{f.name}</span>
          <span className="font-[family-name:var(--font-mono)] text-[10.5px] text-ink-4">
            {Math.ceil(f.size / 1024)} KB
          </span>
          <Tooltip content="Remove">
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label="Remove"
              className="bg-transparent border-0 p-0 text-ink-4 hover:text-danger cursor-pointer inline-grid place-items-center w-[20px] h-[20px] rounded-[4px]"
            >×</button>
          </Tooltip>
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
        <div className="flex flex-col gap-[14px]">
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
                Saved as <code className="font-[family-name:var(--font-mono)] bg-surface-2 py-[1px] px-[5px] rounded-[3px] text-ink-3">.anton/anton.md</code>
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

          <div className="flex flex-col gap-[6px]">
            <span className="font-[family-name:var(--font-mono)] text-xs tracking-[0.06em] uppercase text-ink-4 font-semibold">Files <span className="normal-case tracking-[0] text-ink-4 font-[family-name:var(--font-body)] font-normal">(optional)</span></span>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              onClick={() => !busy && fileInputRef.current?.click()}
              className="py-[22px] px-4 rounded-[9px] text-ink-3 font-[family-name:var(--font-body)] text-[13px] text-center [transition:border-color_120ms_ease,background_120ms_ease,color_120ms_ease]"
              style={{
                // Dynamic (dragActive / busy) — the fill, dashed border colour,
                // and cursor all depend on drag + busy state.
                background: dragActive
                  ? 'color-mix(in srgb, var(--accent) 8%, var(--surface-2))'
                  : 'var(--surface-2)',
                border: `1px dashed ${dragActive ? 'var(--accent)' : 'var(--line-2)'}`,
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              <div className="inline-flex text-ink-3 mb-2">
                {Ico.upload?.(20) || Ico.plus(20)}
              </div>
              <div className="font-medium text-ink-2">
                Drop files here or <span className="text-accent">click to browse</span>
              </div>
              <div className="text-[11.5px] text-ink-4 mt-1">
                Reference docs, schemas, examples — anything the agent should know about.
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
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
