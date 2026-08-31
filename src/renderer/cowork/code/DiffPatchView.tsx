import { useMemo, useState, type MouseEvent } from 'react';

import './review-file.css';

export interface DiffPatchLine {
  index: number;
  text: string;
  kind: 'header' | 'context' | 'addition' | 'deletion';
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffLineSelection {
  start: DiffPatchLine;
  end: DiffPatchLine;
  label: string;
}

export function parseDiffPatch(patch: string): DiffPatchLine[] {
  let oldLine = 0;
  let newLine = 0;
  return patch.split('\n').map((text, index) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { index, text, kind: 'header', oldLine: null, newLine: null };
    }
    if (!oldLine && !newLine || text.startsWith('diff ') || text.startsWith('index ') || text.startsWith('---') || text.startsWith('+++') || text.startsWith('\\')) {
      return { index, text, kind: 'header', oldLine: null, newLine: null };
    }
    if (text.startsWith('+')) {
      const line = { index, text, kind: 'addition' as const, oldLine: null, newLine };
      newLine += 1;
      return line;
    }
    if (text.startsWith('-')) {
      const line = { index, text, kind: 'deletion' as const, oldLine, newLine: null };
      oldLine += 1;
      return line;
    }
    const line = { index, text, kind: 'context' as const, oldLine, newLine };
    oldLine += 1;
    newLine += 1;
    return line;
  });
}

function selectionLabel(start: DiffPatchLine, end: DiffPatchLine): string {
  const first = start.newLine || start.oldLine;
  const last = end.newLine || end.oldLine;
  if (first == null || last == null) return 'selected lines';
  return first === last ? `line ${first}` : `lines ${Math.min(first, last)}–${Math.max(first, last)}`;
}

export function DiffPatchView({ patch, onSelectionChange }: { patch: string; onSelectionChange: (selection: DiffLineSelection | null) => void }) {
  const lines = useMemo(() => parseDiffPatch(patch), [patch]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const select = (event: MouseEvent, line: DiffPatchLine) => {
    if (line.kind === 'header') return;
    const startIndex = event.shiftKey && anchor != null ? anchor : line.index;
    const nextAnchor = event.shiftKey && anchor != null ? anchor : line.index;
    const [low, high] = [startIndex, line.index].sort((a, b) => a - b);
    const selected = lines.filter((item) => item.index >= low && item.index <= high && item.kind !== 'header');
    const start = selected[0];
    const end = selected.at(-1);
    setAnchor(nextAnchor);
    setFocus(line.index);
    onSelectionChange(start && end ? { start, end, label: selectionLabel(start, end) } : null);
  };
  const [low, high] = anchor == null || focus == null ? [-1, -1] : [anchor, focus].sort((a, b) => a - b);
  return (
    <div className="code-diff-patch" role="table" aria-label="File diff">
      {lines.map((line) => (
        <div key={line.index} className={`code-diff-line is-${line.kind}${line.index >= low && line.index <= high && line.kind !== 'header' ? ' is-selected' : ''}`} role="row">
          {line.kind === 'header' ? <span className="code-diff-line__spacer" /> : (
            <button type="button" className="code-diff-line__number" onClick={(event) => select(event, line)} aria-label={`Select ${line.newLine || line.oldLine || 'diff'}${line.kind === 'deletion' ? ' removed' : ''}`}>
              <span>{line.oldLine ?? ''}</span><span>{line.newLine ?? ''}</span>
            </button>
          )}
          <code>{line.text || ' '}</code>
        </div>
      ))}
    </div>
  );
}
