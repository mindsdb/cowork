// A status column can move forward: the dropdown offers the usual values for
// the column, and any other value, not only the ones already in the table.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TableBlock, { suggestedValues } from './TableBlock';

const tracker = () => ({
  id: 'b_t', type: 'table', v: 1, by: 'agent',
  columns: [
    { id: 'c_task', name: 'Task', kind: 'text' },
    { id: 'c_status', name: 'Status', kind: 'status', options: [{ name: 'Not started', tone: 'gray' }] },
  ],
  rows: [{ id: 'r_1', cells: { c_task: 'Post roles', c_status: 'Not started' } }],
});

describe('status cells', () => {
  it('suggests the usual values the column does not have yet', () => {
    expect(suggestedValues({ name: 'Status', options: [{ name: 'Not started' }] })).toEqual(['In progress', 'Blocked', 'Done']);
    expect(suggestedValues({ name: 'Priority', options: [] })).toEqual(['High', 'Medium', 'Low']);
    expect(suggestedValues({ name: 'Stage', options: [{ name: 'Discovery' }] })).toEqual([]);
  });

  it('moves an all-"Not started" tracker forward from the dropdown', async () => {
    const user = userEvent.setup();
    const onOps = vi.fn();
    render(<TableBlock block={tracker()} editable onOps={onOps} />);
    await user.click(screen.getByRole('button', { name: 'Status: Not started' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'In progress' }));
    expect(onOps).toHaveBeenCalledWith([{ op: 'update_cell', table: 'b_t', row: 'r_1', col: 'c_status', value: 'In progress' }]);
  });

  it('takes any other value', async () => {
    const user = userEvent.setup();
    const onOps = vi.fn();
    render(<TableBlock block={tracker()} editable onOps={onOps} />);
    await user.click(screen.getByRole('button', { name: 'Status: Not started' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Other…' }));
    await user.type(await screen.findByRole('textbox', { name: 'New Status' }), 'Waiting on legal{Enter}');
    expect(onOps).toHaveBeenCalledWith([{ op: 'update_cell', table: 'b_t', row: 'r_1', col: 'c_status', value: 'Waiting on legal' }]);
  });

  it('types into the row whose menu it was, right after setting another row', async () => {
    // Found in the packaged app: the menu handed focus back to the row set
    // before, the box lost it at once, and the words landed in that row.
    const user = userEvent.setup();
    const onOps = vi.fn();
    const block = tracker();
    block.rows.push({ id: 'r_2', cells: { ...block.rows[0].cells, c_status: 'Not started' } });
    render(<TableBlock block={block} editable onOps={onOps} />);
    const [first, second] = screen.getAllByRole('button', { name: 'Status: Not started' });
    await user.click(first);
    await user.click(await screen.findByRole('menuitemradio', { name: 'Blocked' }));
    onOps.mockClear();
    await user.click(second);
    await user.click(await screen.findByRole('menuitem', { name: 'Other…' }));
    const box = await screen.findByRole('textbox', { name: 'New Status' });
    await waitFor(() => expect(document.activeElement).toBe(box));
    await user.keyboard('Waiting on legal{Enter}');
    expect(onOps).toHaveBeenCalledTimes(1);
    expect(onOps).toHaveBeenCalledWith([{ op: 'update_cell', table: 'b_t', row: 'r_2', col: 'c_status', value: 'Waiting on legal' }]);
  });

  it('leaves the value alone when typing is cancelled', async () => {
    const user = userEvent.setup();
    const onOps = vi.fn();
    render(<TableBlock block={tracker()} editable onOps={onOps} />);
    await user.click(screen.getByRole('button', { name: 'Status: Not started' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Other…' }));
    await user.type(await screen.findByRole('textbox', { name: 'New Status' }), 'Oops{Escape}');
    expect(onOps).not.toHaveBeenCalled();
  });
});

describe('new rows', () => {
  // The parent applies ops locally at once; this stands in for it.
  function Live({ initial }) {
    const [block, setBlock] = useState(initial);
    const onOps = (ops) => {
      for (const op of ops) {
        if (op.op === 'add_rows') {
          const rows = [...block.rows];
          rows.splice(op.index ?? rows.length, 0, ...op.rows);
          setBlock({ ...block, rows });
        }
      }
    };
    return <TableBlock block={block} editable onOps={onOps} />;
  }

  it('puts the caret in the row it adds', async () => {
    const user = userEvent.setup();
    render(<Live initial={tracker()} />);
    await user.click(screen.getByRole('button', { name: /New row/ }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Task, row 2' }));
  });

  it('does the same for a row inserted above', async () => {
    const user = userEvent.setup();
    render(<Live initial={tracker()} />);
    await user.click(screen.getByRole('button', { name: 'Row 1 options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Insert row above' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Task, row 1' }));
  });
});

describe('where inserts land', () => {
  // Found in review: ops count positions from 1, as the server does, and the
  // editor sent array positions, so "above row 1" landed at the end.
  it('counts positions from 1 for rows and columns, as the server does', async () => {
    const user = userEvent.setup();
    const onOps = vi.fn();
    render(<TableBlock block={tracker()} editable onOps={onOps} />);
    await user.click(screen.getByRole('button', { name: 'Row 1 options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Insert row above' }));
    expect(onOps.mock.lastCall[0][0]).toMatchObject({ op: 'add_rows', index: 1 });
    await user.click(screen.getByRole('button', { name: 'Task column options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Insert column left' }));
    expect(onOps.mock.lastCall[0][0]).toMatchObject({ op: 'add_column', index: 1 });
    await user.click(screen.getByRole('button', { name: 'Task column options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Insert column right' }));
    expect(onOps.mock.lastCall[0][0]).toMatchObject({ op: 'add_column', index: 2 });
  });
});

describe('row options', () => {
  it('are there whatever kind the first column is', async () => {
    // Found in review: only a text or number first column drew them, so a
    // table led by a status or date column could not insert or delete rows.
    const user = userEvent.setup();
    const onOps = vi.fn();
    const block = tracker();
    block.columns.reverse();
    render(<TableBlock block={block} editable onOps={onOps} />);
    await user.click(screen.getByRole('button', { name: 'Row 1 options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete row' }));
    expect(onOps).toHaveBeenCalledWith([{ op: 'delete_rows', table: 'b_t', rows: ['r_1'] }]);
  });

  it('sit inside the table\'s scroll box, in the room it keeps beside the table', () => {
    // Found by the editor engineer: the handle hung 26px left of the table,
    // outside .doc-table-wrap, whose overflow-x clipped it on every table.
    // happy-dom lays nothing out, so this pins the structure and the rules
    // that keep the handle within the box's padding edge.
    const { container } = render(<TableBlock block={tracker()} editable onOps={() => {}} />);
    const handle = screen.getByRole('button', { name: 'Row 1 options' });
    const scrollBox = container.querySelector('.doc-table-wrap');
    expect(handle.closest('.doc-table-frame').parentElement).toBe(scrollBox);

    const css = readFileSync(resolve(__dirname, 'doc.css'), 'utf8');
    const rule = (selector) => new RegExp(`(^|\\n)${selector.replace(/\./g, '\\.')} \\{([^}]*)\\}`).exec(css)?.[2] || '';
    const wrap = rule('.doc-table-wrap');
    expect(wrap).toMatch(/overflow-x: auto/);
    expect(wrap).toMatch(/padding-left: var\(--doc-row-handle\)/);
    expect(wrap).toMatch(/margin: 10px 0 10px calc\(-1 \* var\(--doc-row-handle\)\)/);
    expect(rule('.doc-row-menu')).toMatch(/left: calc\(2px - var\(--doc-row-handle\)\)/);
    // The outline is the frame's: on the scroll box it would draw round the handles.
    expect(wrap).not.toMatch(/border/);
    expect(rule('.doc-table-frame')).toMatch(/border: 1px solid/);
  });

  it('are not offered to a reader', () => {
    render(<TableBlock block={tracker()} editable={false} onOps={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Row 1 options' })).toBeNull();
  });
});

describe('column names', () => {
  it('puts a column\'s name back when it is emptied', () => {
    const onOps = vi.fn();
    render(<TableBlock block={tracker()} editable onOps={onOps} />);
    const [name] = screen.getAllByRole('textbox', { name: 'Column name' });
    name.focus();
    name.textContent = '';
    fireEvent.input(name);
    fireEvent.blur(name);
    expect(name.textContent).toBe('Task');
    expect(onOps).not.toHaveBeenCalled();
  });

  it('renames a column', () => {
    const onOps = vi.fn();
    render(<TableBlock block={tracker()} editable onOps={onOps} />);
    const [name] = screen.getAllByRole('textbox', { name: 'Column name' });
    name.focus();
    name.textContent = ' Owner ';
    fireEvent.input(name);
    fireEvent.blur(name);
    expect(onOps).toHaveBeenCalledWith([{ op: 'update_column', table: 'b_t', col: 'c_task', name: 'Owner' }]);
  });
});



describe('date cells', () => {
  const dated = (when) => ({
    id: 'b_d', type: 'table', v: 1, by: 'agent',
    columns: [{ id: 'c_m', name: 'Milestone', kind: 'text' }, { id: 'c_w', name: 'When', kind: 'date' }],
    rows: [{ id: 'r_1', cells: { c_m: 'Launch', c_w: when } }],
  });

  it('opens a written-out date on its day, and leaving it unchanged saves nothing', async () => {
    // Found in QA: the picker read only ISO, opened empty, and saved "" on leaving.
    const user = userEvent.setup();
    const onOps = vi.fn();
    render(<TableBlock block={dated('December 1, 2026')} editable onOps={onOps} />);
    expect(screen.getByRole('button', { name: 'Date: Dec 1, 2026' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Date:/ }));
    const picker = document.querySelector('input[type="date"]');
    expect(picker.value).toBe('2026-12-01');
    await user.keyboard('{Escape}');
    fireEvent.blur(picker);
    expect(onOps).not.toHaveBeenCalled();
  });

  it('keeps a cell it can\'t read as a date, and saves a day that was picked', async () => {
    const user = userEvent.setup();
    const onOps = vi.fn();
    render(<TableBlock block={dated('TBD')} editable onOps={onOps} />);
    await user.click(screen.getByRole('button', { name: 'Date: TBD' }));
    fireEvent.blur(document.querySelector('input[type="date"]'));
    expect(onOps).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Date: TBD' }));
    const picker = document.querySelector('input[type="date"]');
    fireEvent.change(picker, { target: { value: '2026-12-03' } });
    fireEvent.blur(picker);
    expect(onOps).toHaveBeenCalledWith([{ op: 'update_cell', table: 'b_d', row: 'r_1', col: 'c_w', value: '2026-12-03' }]);
  });
});
