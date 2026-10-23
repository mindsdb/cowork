// ChartBlock draws every kind from its table or its own data, says what is
// missing, and changes through ops.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChartBlock from './ChartBlock';

const table = {
  id: 'b_t', type: 'table',
  columns: [{ id: 'c_v', name: 'Vendor', kind: 'text' }, { id: 'c_p', name: 'Price', kind: 'number' }, { id: 'c_q', name: 'Quote', kind: 'number' }],
  rows: [{ id: 'r_1', cells: { c_v: 'Acme', c_p: '12,000', c_q: '11,000' } }, { id: 'r_2', cells: { c_v: 'Beta', c_p: '-1,500', c_q: '' } }],
};
const fromTable = (chart, extra) => ({ id: 'b_c', type: 'chart', chart, title: 'Cost', unit: '$', source: { table: 'b_t', x: 'Vendor', y: ['Price', 'Quote'] }, ...extra });
const tab = (...blocks) => ({ id: 't_1', title: 'T', blocks: [table, ...blocks] });

describe('ChartBlock', () => {
  it.each(['bar', 'hbar', 'stacked', 'line', 'area'])('draws a %s chart from its table, with a legend', (kind) => {
    const block = fromTable(kind);
    render(<ChartBlock block={block} tab={tab(block)} editable onOps={() => {}} />);
    expect(screen.getByRole('img', { name: 'Cost' })).toBeInTheDocument();
    expect(screen.getByText('Updates with its table')).toBeInTheDocument();
    expect(document.querySelector('.doc-chart__legend').textContent).toBe('PriceQuote');
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
  });

  it('shows the values under the pointer', () => {
    const block = fromTable('bar', { unit: 'hours' });
    render(<ChartBlock block={block} tab={tab(block)} editable onOps={() => {}} />);
    const svg = screen.getByRole('img', { name: 'Cost' });
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 220 });
    fireEvent.mouseMove(svg, { clientX: 100 });
    expect(document.querySelector('.doc-tooltip').textContent).toContain('12K hours');
    expect(screen.getByText('In hours · Updates with its table')).toBeInTheDocument();
    fireEvent.mouseLeave(svg);
    expect(document.querySelector('.doc-tooltip')).toBeNull();
  });

  it('draws a donut from its own data with each share', () => {
    const block = { id: 'b_c', type: 'chart', chart: 'donut', title: 'Mix', x: ['A', 'B'], series: [{ name: 'Share', values: [3, 1] }] };
    render(<ChartBlock block={block} tab={tab(block)} editable={false} onOps={() => {}} />);
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('3 · 75%')).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByText('B').closest('.doc-tooltip__row'));
    expect(screen.getAllByText('B')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Donut' })).toBeNull();
  });

  it('switches its kind', async () => {
    const user = userEvent.setup();
    const onOps = vi.fn();
    const block = fromTable('bar');
    render(<ChartBlock block={block} tab={tab(block)} editable onOps={onOps} />);
    expect(screen.getByRole('button', { name: 'Columns' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Line' }));
    expect(onOps).toHaveBeenCalledWith([{ op: 'update', id: 'b_c', set: { chart: 'line' } }]);
  });

  it('says its table is gone, and offers another', async () => {
    const user = userEvent.setup();
    const onOps = vi.fn();
    const block = fromTable('bar', { source: { table: 'b_gone', x: 'Region', y: ['Price'] } });
    render(<ChartBlock block={block} tab={tab(block)} editable onOps={onOps} />);
    expect(screen.getByText('This chart’s table isn’t in this tab any more.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Use a table/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Table 1: Vendor, Price, Quote' }));
    expect(onOps).toHaveBeenCalledWith([{ op: 'update', id: 'b_c', set: { source: { table: 'b_t', x: 'Vendor', y: ['Price', 'Quote'] } } }]);
  });

  it('says which column is missing, or that there is nothing to draw', () => {
    const noX = fromTable('bar', { source: { table: 'b_t', x: 'Region', y: ['Price'] } });
    const { unmount } = render(<ChartBlock block={noX} tab={tab(noX)} editable={false} onOps={() => {}} />);
    expect(screen.getByText('Its table has no “Region” column.')).toBeInTheDocument();
    unmount();
    const empty = { id: 'b_c', type: 'chart', chart: 'bar', title: 'Empty', x: [], series: [] };
    render(<ChartBlock block={empty} tab={tab(empty)} editable={false} onOps={() => {}} />);
    expect(screen.getByText('No numbers to draw yet.')).toBeInTheDocument();
  });

  it('turns its own data into a table it then draws from', async () => {
    const user = userEvent.setup();
    const onOps = vi.fn();
    const block = { id: 'b_c', type: 'chart', chart: 'bar', title: 'Q', x: ['Q1', 'Q2'], series: [{ name: 'Value', values: [12, null] }] };
    render(<ChartBlock block={block} tab={tab(block)} editable onOps={onOps} />);
    await user.click(screen.getByRole('button', { name: 'Turn data into a table' }));
    const [insert, update] = onOps.mock.calls[0][0];
    const [xCol, yCol] = insert.blocks[0].columns;
    expect(insert).toMatchObject({ op: 'insert', position: { before: 'b_c' }, blocks: [{ type: 'table' }] });
    expect(insert.blocks[0].rows.map((r) => [r.cells[xCol.id], r.cells[yCol.id]])).toEqual([['Q1', '12'], ['Q2', '']]);
    expect(update).toEqual({ op: 'update', id: 'b_c', set: { source: { table: insert.blocks[0].id, x: 'Label', y: ['Value'] } } });
  });

  it('shows its table on request', async () => {
    const user = userEvent.setup();
    const onShowTable = vi.fn();
    const block = fromTable('bar');
    render(<ChartBlock block={block} tab={tab(block)} editable onOps={() => {}} onShowTable={onShowTable} />);
    await user.click(screen.getByRole('button', { name: 'Show its table' }));
    expect(onShowTable).toHaveBeenCalledWith('b_t');
  });
});
