// TableBlock — a table people work in: type in cells, pick a status from a
// dropdown chip, set a date, add/insert/delete rows and columns, change a
// column's kind, sort. Every change is one of the shared doc ops.
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Calendar, ChevronDown, CircleDot, Ellipsis, Hash, Plus, Type } from 'lucide-react';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui';
import EditableText from './EditableText';
import { formatDate, newId, opIndex, toIsoDate, toneFor } from './docModel';

const COLUMN_KINDS = {
  text: { label: 'Text', icon: Type },
  number: { label: 'Number', icon: Hash },
  status: { label: 'Status', icon: CircleDot },
  date: { label: 'Date', icon: Calendar },
};

// Values people reach for in common columns. A tracker the agent writes often
// starts with every row on one value ("Not started"), and the dropdown only
// offers values already used, so it could never move forward from there.
const SUGGESTED = [
  [/status|state|progress/i, ['Not started', 'In progress', 'Blocked', 'Done']],
  [/priority|risk|severity|impact/i, ['High', 'Medium', 'Low']],
  [/decision/i, ['Proposed', 'Approved', 'Rejected']],
  [/health/i, ['On track', 'At risk', 'Off track']],
  [/result|outcome/i, ['Pass', 'Fail']],
];

export function suggestedValues(column) {
  const have = new Set((column.options || []).map((o) => o.name.toLowerCase()));
  const match = SUGGESTED.find(([re]) => re.test(column.name || ''));
  return match ? match[1].filter((v) => !have.has(v.toLowerCase())) : [];
}

function StatusCell({ value, column, editable, onChange }) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  // "Other…" types a value in place of the menu. The box opens only once the
  // menu has closed: closing returns focus to whatever had it when the menu
  // opened (often another row's chip), which blurred a box opened at once,
  // and its blur closed it before anything could be typed.
  const otherAsked = useRef(false);
  const onOpenChange = (next) => {
    setOpen(next);
    if (!next && otherAsked.current) {
      otherAsked.current = false;
      requestAnimationFrame(() => requestAnimationFrame(() => setTyping(true)));
    }
  };
  const option = (column.options || []).find((o) => o.name.toLowerCase() === String(value || '').toLowerCase());
  const tone = option?.tone || toneFor(value);
  const chip = value ? <span className={`doc-chip doc-tone--${tone}`}>{value}</span> : <span style={{ color: 'var(--ink-5)' }}>—</span>;
  if (!editable) return <div className="doc-td">{chip}</div>;
  if (typing) {
    // Any other value: it becomes one of the column's options once set.
    const done = (el, commit) => {
      setTyping(false);
      const v = el.value.trim();
      if (commit && v && v !== value) onChange(v);
    };
    return (
      <div className="doc-td">
        <input
          className="doc-date-input"
          autoFocus
          aria-label={`New ${column.name}`}
          placeholder={column.name}
          defaultValue=""
          onBlur={(e) => done(e.currentTarget, true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); done(e.currentTarget, true); }
            if (e.key === 'Escape') { e.preventDefault(); done(e.currentTarget, false); }
          }}
        />
      </div>
    );
  }
  const suggestions = suggestedValues(column);
  return (
    <div className="doc-td">
      <Menu
        open={open}
        onOpenChange={onOpenChange}
        ariaLabel={`Set ${column.name}`}
        trigger={<button type="button" className="doc-cellbtn" aria-label={`${column.name}: ${value || 'empty'}`}>{chip}</button>}
        items={[
          ...(column.options || []).map((o) => ({
            key: o.name,
            label: <span className={`doc-chip doc-tone--${o.tone}`}>{o.name}</span>,
            onClick: () => onChange(o.name),
            aria: { role: 'menuitemradio', 'aria-checked': o.name === value },
          })),
          ...suggestions.map((name) => ({
            key: `suggest-${name}`,
            label: <span className={`doc-chip doc-tone--${toneFor(name)}`}>{name}</span>,
            onClick: () => onChange(name),
            aria: { role: 'menuitemradio', 'aria-checked': false },
          })),
          { divider: true },
          { key: '__other', label: 'Other…', onClick: () => { otherAsked.current = true; } },
          ...(value ? [{ key: '__clear', label: 'Clear', onClick: () => onChange('') }] : []),
        ]}
      />
    </div>
  );
}

function DateCell({ value, editable, onChange }) {
  const [editing, setEditing] = useState(false);
  // The picker reads only ISO: a date written out ("December 1, 2026") opens
  // on that day, and only a change the person makes is saved. Saving what the
  // picker held on leaving blanked any date it couldn't read.
  const iso = toIsoDate(value);
  const picked = useRef(false);
  if (editable && editing) {
    return (
      <div className="doc-td">
        <input
          type="date"
          className="doc-date-input"
          autoFocus
          defaultValue={iso || ''}
          onChange={() => { picked.current = true; }}
          onBlur={(e) => {
            setEditing(false);
            if (picked.current && e.target.value !== (iso || value)) onChange(e.target.value);
            picked.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') picked.current = false;
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
          }}
        />
      </div>
    );
  }
  const label = value ? (iso ? formatDate(iso) : value) : '';
  return (
    <div className="doc-td">
      {editable
        ? <button type="button" className="doc-cellbtn" onClick={() => setEditing(true)} aria-label={`Date: ${label || 'empty'}`}>{label || <span style={{ color: 'var(--ink-5)' }}>—</span>}</button>
        : label}
    </div>
  );
}

function ColumnHeader({ table, column, index, editable, onOps }) {
  const [open, setOpen] = useState(false);
  const set = (patch) => onOps([{ op: 'update_column', table: table.id, col: column.id, ...patch }]);
  const items = [
    { heading: 'Type' },
    ...Object.entries(COLUMN_KINDS).map(([k, kind]) => ({
      key: `kind-${k}`,
      icon: <Icon of={kind.icon} size={14} />,
      label: kind.label,
      onClick: () => set({ kind: k }),
      aria: { role: 'menuitemradio', 'aria-checked': column.kind === k },
    })),
    { divider: true },
    { key: 'asc', icon: <Icon of={ArrowUp} size={14} />, label: 'Sort ascending', onClick: () => onOps([{ op: 'sort_rows', table: table.id, col: column.id }]) },
    { key: 'desc', icon: <Icon of={ArrowDown} size={14} />, label: 'Sort descending', onClick: () => onOps([{ op: 'sort_rows', table: table.id, col: column.id, descending: true }]) },
    { divider: true },
    { key: 'left', label: 'Insert column left', onClick: () => onOps([{ op: 'add_column', table: table.id, name: 'Column', index: opIndex(index) }]) },
    { key: 'right', label: 'Insert column right', onClick: () => onOps([{ op: 'add_column', table: table.id, name: 'Column', index: opIndex(index + 1) }]) },
    ...(table.columns.length > 1 ? [{ divider: true }, { key: 'del', danger: true, label: 'Delete column', onClick: () => onOps([{ op: 'delete_column', table: table.id, col: column.id }]) }] : []),
  ];
  return (
    <th scope="col" className={column.kind === 'number' ? 'doc-td--number' : ''}>
      <div className="doc-th">
        <span className="doc-th__kind" aria-hidden="true"><Icon of={COLUMN_KINDS[column.kind]?.icon || Type} size={12} /></span>
        <EditableText
          className="doc-th__name"
          value={column.name}
          plain
          singleLine
          editable={editable}
          ariaLabel="Column name"
          onCommit={(name) => {
            if (!name.trim()) return false; // a column keeps a name: the old one comes back
            set({ name: name.trim() });
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        />
        {editable && (
          <span className="doc-th__menu" data-open={open}>
            <Menu
              open={open}
              onOpenChange={setOpen}
              ariaLabel={`${column.name} column`}
              trigger={<button type="button" className="doc-gutter__btn" aria-label={`${column.name} column options`}><Icon of={ChevronDown} size={14} /></button>}
              items={items}
            />
          </span>
        )}
      </div>
    </th>
  );
}

function RowMenu({ table, row, index, onOps, onAddRow }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="doc-row-menu" data-open={open}>
      <Menu
        open={open}
        onOpenChange={setOpen}
        ariaLabel="Row options"
        trigger={<button type="button" className="doc-gutter__btn" aria-label={`Row ${index + 1} options`}><Icon of={Ellipsis} size={14} /></button>}
        items={[
          { key: 'above', label: 'Insert row above', onClick: () => onAddRow(index) },
          { key: 'below', label: 'Insert row below', onClick: () => onAddRow(index + 1) },
          { divider: true },
          { key: 'del', danger: true, label: 'Delete row', onClick: () => onOps([{ op: 'delete_rows', table: table.id, rows: [row.id] }]) },
        ]}
      />
    </span>
  );
}

export default function TableBlock({ block, editable, onOps }) {
  const wrap = useRef(null);
  const blankRow = () => ({ id: newId('r_'), cells: Object.fromEntries(block.columns.map((c) => [c.id, ''])) });
  // A new row takes the caret, so typing goes into it rather than nowhere.
  const focusRowAt = useRef(null);
  const addRow = (index) => {
    focusRowAt.current = index ?? block.rows.length;
    onOps([{ op: 'add_rows', table: block.id, rows: [blankRow()], ...(index != null ? { index: opIndex(index) } : {}) }]);
  };
  useEffect(() => {
    const at = focusRowAt.current;
    if (at == null || block.rows.length <= at) return;
    focusRowAt.current = null;
    wrap.current?.querySelector(
      `tbody tr:nth-child(${at + 1}) td:first-child [contenteditable="true"], tbody tr:nth-child(${at + 1}) td:first-child button.doc-cellbtn`,
    )?.focus();
  }, [block.rows.length]);

  const setCell = (row, col, value) =>
    onOps([{ op: 'update_cell', table: block.id, row: row.id, col: col.id, value }]);

  /** Tab / Shift+Tab / Enter move between cells like a spreadsheet. */
  const moveFocus = (fromRow, fromCol, dRow, dCol) => {
    if (!wrap.current) return;
    const ncol = block.columns.length;
    let r = fromRow; let c = fromCol + dCol;
    if (c >= ncol) { c = 0; r += 1; }
    if (c < 0) { c = ncol - 1; r -= 1; }
    r += dRow;
    if (r >= block.rows.length) {
      if (dRow > 0 || dCol > 0) addRow();
      return;
    }
    if (r < 0) return;
    const target = wrap.current.querySelector(`tbody tr:nth-child(${r + 1}) td:nth-child(${c + 1}) [contenteditable="true"], tbody tr:nth-child(${r + 1}) td:nth-child(${c + 1}) button.doc-cellbtn`);
    target?.focus();
  };

  return (
    <div className="doc-table-wrap" ref={wrap}>
      <div className="doc-table-frame">
        <table className="doc-table">
          <thead>
            <tr>
              {block.columns.map((col, ci) => (
                <ColumnHeader key={col.id} table={block} column={col} index={ci} editable={editable} onOps={onOps} />
              ))}
              {editable && (
                <th className="doc-table__addcol">
                  <button type="button" className="doc-gutter__btn" style={{ margin: '6px auto', display: 'grid' }} aria-label="Add column"
                    onClick={() => onOps([{ op: 'add_column', table: block.id, name: 'Column' }])}>
                    <Icon of={Plus} size={14} />
                  </button>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={row.id}>
                {block.columns.map((col, ci) => {
                  const value = row.cells[col.id] ?? '';
                  const onChange = (v) => setCell(row, col, v);
                  return (
                    <td key={col.id} style={{ position: ci === 0 ? 'relative' : undefined }}>
                      {ci === 0 && editable && <RowMenu table={block} row={row} index={ri} onOps={onOps} onAddRow={addRow} />}
                      {col.kind === 'status' ? (
                        <StatusCell value={value} column={col} editable={editable} onChange={onChange} />
                      ) : col.kind === 'date' ? (
                        <DateCell value={value} editable={editable} onChange={onChange} />
                      ) : (
                        <EditableText
                          className={`doc-td ${col.kind === 'number' ? 'doc-td--number' : ''}`}
                          value={value}
                          editable={editable}
                          singleLine
                          ariaLabel={`${col.name}, row ${ri + 1}`}
                          onCommit={onChange}
                          onKeyDown={(e, api) => {
                            if (e.key === 'Tab') { e.preventDefault(); api.flush(); moveFocus(ri, ci, 0, e.shiftKey ? -1 : 1); }
                            else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); api.flush(); moveFocus(ri, ci, 1, 0); }
                            else if (e.key === 'Escape') { e.currentTarget.blur(); }
                          }}
                        />
                      )}
                    </td>
                  );
                })}
                {editable && <td className="doc-table__addcol" />}
              </tr>
            ))}
          </tbody>
        </table>
        {editable && (
          <div className="doc-table__foot">
            <button type="button" className="doc-addbtn" onClick={() => addRow()}>
              <Icon of={Plus} size={14} /> New row
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
