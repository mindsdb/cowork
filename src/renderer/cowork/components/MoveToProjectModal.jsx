// Move a task to another project. Search the existing projects or type a
// new name to create one, and choose whether to bring the task's artifacts
// and files along ("move everything", default on). The actual move +
// (optional) object relocation happens server-side; the parent's onConfirm
// creates the project if it's new, then calls the move endpoint.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal';
import { Button, Checkbox } from './ui';

export default function MoveToProjectModal({ open, task, projects = [], onClose, onConfirm }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);   // existing project name
  const [moveEverything, setMoveEverything] = useState(true);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  // Reset each time the modal opens for a (possibly different) task.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(null);
      setMoveEverything(true);
      setBusy(false);
      // focus the search after the modal paints
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open, task?.id]);

  const currentName = task?.projectName || '';
  const q = query.trim();

  const candidates = useMemo(() => {
    const others = projects.filter((p) => p.name !== currentName);
    if (!q) return others;
    const lc = q.toLowerCase();
    return others.filter((p) => p.name.toLowerCase().includes(lc));
  }, [projects, currentName, q]);

  // A typed name that matches no existing project (and isn't the current
  // one) becomes a "create new project" option.
  const exactMatch = projects.some((p) => p.name.toLowerCase() === q.toLowerCase());
  const canCreateNew = q.length > 0 && !exactMatch && q !== currentName;

  const destName = selected || (canCreateNew ? q : null);
  const canConfirm = !!destName && !busy;

  const submit = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await onConfirm?.(destName, { isNew: !selected && canCreateNew, moveEverything });
    } finally {
      setBusy(false);
    }
  };

  const rowStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', textAlign: 'left',
    padding: '9px 11px', borderRadius: 9, cursor: 'pointer', fontSize: 13,
    border: active ? '1px solid var(--accent)' : '1px solid transparent',
    background: active ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
    color: active ? 'var(--accent)' : 'inherit',
  });

  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="move-modal-title">
      <ModalHeader
        id="move-modal-title"
        title="Move to project"
        subtitle={task?.title ? `Move “${task.title}” and its work` : 'Move this task and its work'}
        onClose={onClose}
      />
      <ModalBody>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Search projects or type a new name…"
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13,
            border: '1px solid var(--line, rgba(128,128,128,0.3))',
            background: 'var(--surface-2, transparent)', color: 'inherit', outline: 'none',
            marginBottom: 10,
          }}
        />

        <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {candidates.map((p) => (
            <button
              key={p.name}
              type="button"
              style={rowStyle(selected === p.name)}
              onClick={() => { setSelected(p.name); }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              {selected === p.name && <span aria-hidden>✓</span>}
            </button>
          ))}

          {canCreateNew && (
            <button
              type="button"
              style={rowStyle(!selected)}
              onClick={() => setSelected(null)}
            >
              <span aria-hidden style={{ opacity: 0.8 }}>＋</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Create “{q}”
              </span>
            </button>
          )}

          {!candidates.length && !canCreateNew && (
            <div style={{ padding: '10px 4px', fontSize: 12.5, opacity: 0.6 }}>
              {currentName ? `This task is already in “${currentName}”.` : 'No other projects yet — type a name to create one.'}
            </div>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13, cursor: 'pointer' }}>
          <Checkbox
            checked={moveEverything}
            onCheckedChange={setMoveEverything}
            aria-label="Move everything — the files and artifacts this task created"
          />
          <span>Move everything — the files &amp; artifacts this task created</span>
        </label>
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!canConfirm}>
          {busy ? 'Moving…' : destName ? `Move to ${destName}` : 'Move'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
