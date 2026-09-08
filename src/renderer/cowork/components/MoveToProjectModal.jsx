// Move a task to another project. Search the existing projects or type a
// new name to create one, and choose whether to bring the task's artifacts
// and files along ("move everything", default on). The actual move +
// (optional) object relocation happens server-side; the parent's onConfirm
// creates the project if it's new, then calls the move endpoint.

import { useEffect, useMemo, useRef, useState } from 'react';
import { projectLabel, projectMatches, projectNamed } from '../lib/projectLabel';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal';
import { Button, Checkbox, Input } from './ui';

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
    return others.filter((p) => projectMatches(p, lc));
  }, [projects, currentName, q]);

  // A typed name that matches no existing project (and isn't the current
  // one) becomes a "create new project" option.
  const exactMatch = projects.some((p) => projectNamed(p, q));
  const canCreateNew = q.length > 0 && !exactMatch && q !== currentName;

  const destName = selected || (canCreateNew ? q : null);
  const canConfirm = !!destName && !busy;

  const ROW_CLASS = 'flex items-center gap-2 w-full text-left py-[9px] px-[11px] rounded-[9px] cursor-pointer text-[13px]';

  const submit = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await onConfirm?.(destName, { isNew: !selected && canCreateNew, moveEverything });
    } finally {
      setBusy(false);
    }
  };

  // The row's active state drives border/background/colour off a color-mix and
  // `inherit`, so it stays inline; the static layout is a className constant.
  const rowStyle = (active) => ({
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
        <Input
          ref={inputRef}
          value={query}
          onChange={(v) => { setQuery(v); setSelected(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Search projects or type a new name…"
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13,
            border: '1px solid var(--line, rgba(128,128,128,0.3))',
            background: 'var(--surface-2, transparent)', color: 'inherit', outline: 'none',
            marginBottom: 10,
          }}
        />

        <div className="max-h-[220px] overflow-y-auto flex flex-col gap-[2px]">
          {candidates.map((p) => (
            <button
              key={p.name}
              type="button"
              className={ROW_CLASS}
              style={rowStyle(selected === p.name)}
              onClick={() => { setSelected(p.name); }}
            >
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{projectLabel(p)}</span>
              {selected === p.name && <span aria-hidden>✓</span>}
            </button>
          ))}

          {canCreateNew && (
            <button
              type="button"
              className={ROW_CLASS}
              style={rowStyle(!selected)}
              onClick={() => setSelected(null)}
            >
              <span aria-hidden className="opacity-80">＋</span>
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                Create “{q}”
              </span>
            </button>
          )}

          {!candidates.length && !canCreateNew && (
            <div className="py-[10px] px-1 text-sm opacity-60">
              {currentName ? `This task is already in “${currentName}”.` : 'No other projects yet — type a name to create one.'}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 mt-[14px] text-[13px] cursor-pointer">
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
