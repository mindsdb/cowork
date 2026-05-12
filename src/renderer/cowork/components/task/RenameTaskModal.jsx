import { useEffect, useRef, useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';

function Field({ label, children }) {
  return (
    <label className="flex flex-col">
      <span className="mb-1.5 font-body text-[11.5px] font-medium uppercase tracking-[0.02em] text-ink-3">
        {label}
      </span>
      {children}
    </label>
  );
}

export default function RenameTaskModal({
  open,
  task,
  busy = false,
  onClose,
  onSubmit,
}) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title || '');
    setError('');
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      try { inputRef.current?.select(); } catch {}
    });
    return () => cancelAnimationFrame(id);
  }, [open, task?.id, task?.title]);

  async function handleSubmit() {
    const next = title.trim();
    if (!next) {
      setError('Enter a title for this task.');
      return;
    }
    if (next === (task?.title || '').trim()) {
      onClose?.();
      return;
    }
    setError('');
    try {
      await onSubmit?.(next);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not rename this task.');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      labelledBy="rename-task-modal-title"
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
    >
      <ModalHeader
        id="rename-task-modal-title"
        title="Rename task"
        subtitle="Give this conversation a clearer name for recents, pins, and project lists."
        onClose={busy ? undefined : onClose}
      />
      <ModalBody padding="18px 20px">
        <Field label="Task name">
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={busy}
            spellCheck={false}
            className="box-border w-full rounded-[7px] border border-line bg-surface-2 px-2.5 py-[9px] font-body text-[13.5px] text-ink outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
        </Field>
        {error && (
          <div className="mt-3 rounded-[7px] border border-danger/35 bg-danger/10 px-2.5 py-2 font-body text-[12.5px] text-danger">
            {error}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-line bg-transparent px-[13px] py-2 font-body text-[13px] font-medium text-ink-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy}
          className="btn-primary"
        >
          {busy ? 'Saving...' : 'Save'}
        </button>
      </ModalFooter>
    </Modal>
  );
}
