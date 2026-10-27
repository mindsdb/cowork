import { describe, expect, it } from 'vitest';
import {
  applyLocal, blockPlainText, chartData, chartSourceTable, formatDate, holdsEdit, htmlToInline, inlineToHtml, inlineToPlain,
  isListBlock, isTextBlock, makeBlock, newId, opIndex, sourceForTable, toIsoDate, toNumber, toneFor, undoStillApplies,
} from './docModel';

const roundTrip = (md) => {
  const div = document.createElement('div');
  div.innerHTML = inlineToHtml(md);
  return htmlToInline(div);
};

describe('inline Markdown ⇄ HTML', () => {
  it('renders the inline subset the agent writes', () => {
    const html = inlineToHtml('**Acme** is *cheapest* at `$12k` — [quote](https://example.com/q) by {{date:2026-10-21}}');
    expect(html).toContain('<strong>Acme</strong>');
    expect(html).toContain('<em>cheapest</em>');
    expect(html).toContain('<code>$12k</code>');
    expect(html).toContain('href="https://example.com/q"');
    expect(html).toContain('Oct 21, 2026');
  });

  it('formats nested marks without hanging', () => {
    // Regression: one shared /g regex recursed and reset lastIndex under itself.
    const html = inlineToHtml('**bold with *italic* and [a link](https://x.io) inside**');
    expect(html).toBe('<strong>bold with <em>italic</em> and <a href="https://x.io" target="_blank" rel="noopener noreferrer">a link</a> inside</strong>');
  });

  it('escapes HTML and refuses non-http links', () => {
    expect(inlineToHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(inlineToHtml('[x](javascript:alert(1))')).not.toContain('href');
  });

  it('round-trips through the editor DOM', () => {
    for (const md of [
      'Plain words.',
      '**Bold** and *italic* and ~~gone~~',
      'Use `npm test` first',
      'See [the brief](https://example.com/brief) today',
      'Due {{date:2026-11-04}} · {{status:In progress}}',
    ]) {
      expect(roundTrip(md)).toBe(md);
    }
  });

  it('escapes literal markers typed by a person so they stay literal', () => {
    const div = document.createElement('div');
    div.textContent = '2 * 3 = 6 and `x`';
    const md = htmlToInline(div);
    expect(md).toBe('2 \\* 3 = 6 and \\`x\\`');
    expect(inlineToPlain(md)).toBe('2 * 3 = 6 and `x`');
  });

  it('reads bold/italic the browser writes as tags', () => {
    const div = document.createElement('div');
    div.innerHTML = 'a <b>b</b> <i>c </i>d';
    expect(htmlToInline(div)).toBe('a **b** *c* d');
  });
});

describe('numbers, tones, dates', () => {
  it.each([
    ['1,200', 1200],
    ['$1.5M', 1500000],
    ['-3.2%', -3.2],
    ['12k', 12000],
    ['−4', -4],
    ['2B', 2000000000],
    ['  42 ', 42],
    ['+€7.25', 7.25],
    ['£1,234,567.8K', 1234567800],
    ['**1,200**', 1200],
    ['_$1.5M_', 1500000],
    ['__7__', 7],
    ['*-2k*', -2000],
    ['$1.1M', 1100000],
    ['1.005K', 1005],
    ['** 42 **', 42],
    ['0.1234567', 0.1234567],
    ['0.0078125', 0.0078125],
  ])('reads %j as %d, as the server does', (input, value) => {
    expect(toNumber(input)).toBe(value);
  });

  it.each(['500 MB', '1e6', '12-15', '5pm', '1,20', '', 'n/a', '(1,200)', '2bn', '1.5m', '.5', '1.', '$-3', '12 k',
    '**12-15**', '*5*%', '**5*', '***5***', '**'])(
    'reads %j as no number',
    // Found in review: everything but digits and dots was thrown away, so
    // "500 MB" plotted as 5e11, "1e6" as 16, "12-15" as 1215 and "5pm" as 5e6.
    (input) => { expect(toNumber(input)).toBeNull(); },
  );
  it('gives status words the server tone', () => {
    expect(toneFor('Done')).toBe('green');
    expect(toneFor('In progress')).toBe('blue');
    expect(toneFor('Blocked')).toBe('red');
    expect(toneFor('Shortlisted')).toBe('yellow');
    expect(toneFor('Whatever')).toBe('gray');
  });
  it('formats ISO dates', () => {
    expect(formatDate('2026-10-21')).toBe('Oct 21, 2026');
    expect(formatDate('next week')).toBe('next week');
  });
});

const sampleDoc = () => {
  const cols = [{ id: 'c_a', name: 'Vendor', kind: 'text' }, { id: 'c_b', name: 'Price', kind: 'number' }];
  return {
    schema: 'cowork.doc/1',
    id: 'd',
    title: 'Plan',
    rev: 3,
    tabs: [{
      id: 't_1',
      title: 'Plan',
      blocks: [
        { id: 'b_1', type: 'paragraph', text: 'Lead' },
        { id: 'b_2', type: 'table', columns: cols, rows: [{ id: 'r_1', cells: { c_a: 'Acme', c_b: '12,000' } }, { id: 'r_2', cells: { c_a: 'Beta', c_b: '15,500' } }] },
        { id: 'b_3', type: 'chart', chart: 'bar', title: 'Cost', source: { table: 'b_2', x: 'Vendor', y: ['Price'] } },
      ],
    }],
  };
};

describe('applyLocal', () => {
  it('applies the ops the editor makes, without touching the input', () => {
    const doc = sampleDoc();
    const next = applyLocal(doc, [
      { op: 'update', id: 'b_1', set: { type: 'heading', level: 2, text: 'Lead in' } },
      { op: 'insert', position: { after: 'b_1' }, blocks: [{ id: 'b_9', type: 'paragraph', text: 'New' }] },
      { op: 'update_cell', table: 'b_2', row: 'r_2', col: 'c_b', value: '14,900' },
    ]);
    expect(doc.tabs[0].blocks[0].type).toBe('paragraph');
    expect(next.tabs[0].blocks.map((b) => b.id)).toEqual(['b_1', 'b_9', 'b_2', 'b_3']);
    expect(next.tabs[0].blocks[0]).toMatchObject({ type: 'heading', level: 2, text: 'Lead in', by: 'user' });
    expect(next.tabs[0].blocks[2].rows[1].cells.c_b).toBe('14,900');
  });

  it('moves and deletes blocks', () => {
    const next = applyLocal(sampleDoc(), [
      { op: 'move', ids: ['b_3'], position: { before: 'b_1' } },
      { op: 'delete', target: ['b_2'] },
    ]);
    expect(next.tabs[0].blocks.map((b) => b.id)).toEqual(['b_3', 'b_1']);
  });

  it('says when an edit no longer applies: something it targets is gone', () => {
    const doc = sampleDoc();
    doc.tabs.push({ id: 't_2', title: 'Notes', blocks: [] });
    for (const op of [
      { op: 'update', id: 'b_gone', set: { text: 'x' } },
      { op: 'delete', target: ['b_1', 'b_gone'] },
      { op: 'move', ids: ['b_gone'], position: { after: 'b_1' } },
      { op: 'insert', position: { after: 'b_gone' }, markdown: '## Hi' },
      { op: 'replace', target: 'b_gone', markdown: 'x' },
      { op: 'add_column', table: 'b_gone', name: 'Cost' },
      { op: 'sort_rows', table: 'b_2', col: 'c_gone' },
      { op: 'update_column', table: 'b_gone', col: 'c_b', name: 'Cost' },
      { op: 'delete_rows', table: 'b_2', rows: ['r_1', 'r_gone'] },
      { op: 'delete_tab', tab: 't_gone' },
      { op: 'unknown' },
    ]) expect(applyLocal(doc, [op], { tab: 't_1' })).toBeNull();
  });

  it('leaves what only the server can work out as it is, until it answers', () => {
    const doc = sampleDoc();
    for (const op of [
      { op: 'insert', position: 'end', markdown: '## Hi' },
      { op: 'replace', target: 'b_1', markdown: 'Hi' },
      { op: 'add_column', table: 'b_2', name: 'Cost' },
      { op: 'update_column', table: 'b_2', col: 'c_b', name: 'Cost' },
      { op: 'sort_rows', table: 'b_2', col: 'c_b' },
      { op: 'add_tab', title: 'Untitled' },
    ]) expect(applyLocal(doc, [op], { tab: 't_1' })).toEqual(doc);
  });

  it('renames a one-tab doc and its page together', () => {
    const next = applyLocal(sampleDoc(), [{ op: 'rename_doc', title: 'Plan v2' }]);
    expect(next.title).toBe('Plan v2');
    expect(next.tabs[0].title).toBe('Plan v2');
  });
});

describe('holdsEdit', () => {
  const block = { id: 'b_9', type: 'paragraph', text: 'New', by: 'user' };
  const row = { id: 'r_9', cells: {} };

  it('says an insert landed when every block and row it adds is there', () => {
    const doc = sampleDoc();
    const ops = [
      { op: 'update', id: 'b_1', set: { text: 'Le' } },
      { op: 'insert', position: { after: 'b_1' }, blocks: [block] },
    ];
    expect(holdsEdit(doc, ops, { tab: 't_1' })).toBe(false);
    expect(holdsEdit(applyLocal(doc, ops, { tab: 't_1' }), ops, { tab: 't_1' })).toBe(true);
    const rows = [{ op: 'add_rows', table: 'b_2', rows: [row] }];
    expect(holdsEdit(doc, rows, { tab: 't_1' })).toBe(false);
    expect(holdsEdit(applyLocal(doc, rows, { tab: 't_1' }), rows, { tab: 't_1' })).toBe(true);
  });

  it('says an edit that adds nothing landed when what it removes is gone and the rest replays as it is', () => {
    const doc = sampleDoc();
    // A merge: the text moves up into b_1, and the block it came from goes.
    const merge = [{ op: 'update', id: 'b_1', set: { text: 'Lead in' } }, { op: 'delete', target: ['b_3'] }];
    expect(holdsEdit(doc, merge, { tab: 't_1' })).toBe(false);
    const landed = sampleDoc();
    // As the server writes it: its stamps, its key order.
    landed.tabs[0].blocks = [{ by: 'user', v: 4, text: 'Lead in', type: 'paragraph', id: 'b_1' }, landed.tabs[0].blocks[1]];
    expect(holdsEdit(landed, merge, { tab: 't_1' })).toBe(true);
    expect(holdsEdit(landed, [{ op: 'update', id: 'b_1', set: { text: 'Other' } }], { tab: 't_1' })).toBe(false);
  });

  it('reads each removal as gone once it landed', () => {
    const doc = sampleDoc();
    doc.tabs.push({ id: 't_2', title: 'Notes', blocks: [] });
    const removals = [
      { op: 'delete_rows', table: 'b_2', rows: ['r_1'] },
      { op: 'delete_column', table: 'b_2', col: 'c_a' },
      { op: 'delete_tab', tab: 't_2' },
    ];
    for (const op of removals) {
      expect(holdsEdit(doc, [op], { tab: 't_1' })).toBe(false);
      expect(holdsEdit(applyLocal(doc, [op], { tab: 't_1' }), [op], { tab: 't_1' })).toBe(true);
    }
  });

  it('cannot tell for what only the server works out', () => {
    const doc = sampleDoc();
    expect(holdsEdit(doc, [{ op: 'insert', position: 'end', markdown: '## Hi' }], { tab: 't_1' })).toBe(false);
    expect(holdsEdit(doc, [{ op: 'sort_rows', table: 'b_2', col: 'c_b' }], { tab: 't_1' })).toBe(false);
  });
});

describe('chartData', () => {
  it('draws from its source table, live', () => {
    const doc = sampleDoc();
    const tab = doc.tabs[0];
    expect(chartData(tab.blocks[2], tab)).toMatchObject({ labels: ['Acme', 'Beta'], series: [{ name: 'Price', values: [12000, 15500] }] });
    const edited = applyLocal(doc, [{ op: 'update_cell', table: 'b_2', row: 'r_1', col: 'c_b', value: '9,000' }]);
    expect(chartData(edited.tabs[0].blocks[2], edited.tabs[0]).series[0].values).toEqual([9000, 15500]);
  });
  it('says what is missing', () => {
    const tab = sampleDoc().tabs[0];
    expect(chartData({ type: 'chart', source: { table: 'b_gone', x: 'Region', y: ['Price'] } }, tab).missing).toBe('table');
    expect(chartData({ type: 'chart', source: { table: 'b_2', x: 'Nope', y: ['Price'] } }, tab).missing).toBe('x');
  });
});

describe('ids and factories', () => {
  it('mints ids in the shape the server keeps', () => {
    expect(newId('b_')).toMatch(/^b_[a-z0-9]{8}$/);
    const t = makeBlock('table');
    expect(t.columns).toHaveLength(3);
    expect(t.rows[0].cells[t.columns[0].id]).toBe('');
  });
});

describe('chart sources that lost their table', () => {
  it('draw from the table that holds their columns', () => {
    const doc = sampleDoc();
    const tab = doc.tabs[0];
    tab.blocks[2] = { ...tab.blocks[2], source: { table: 'b_gone0000', x: 'Vendor', y: ['Price'] } };
    expect(chartData(tab.blocks[2], tab)).toMatchObject({ labels: ['Acme', 'Beta'], series: [{ name: 'Price' }] });
  });
  it('can be pointed at any table, text column against number columns', () => {
    expect(sourceForTable(sampleDoc().tabs[0].blocks[1])).toEqual({ table: 'b_2', x: 'Vendor', y: ['Price'] });
  });

  it('take the first other column when a table has no numbers', () => {
    const t = { id: 'b_t', columns: [{ id: 'a', name: 'Who', kind: 'text' }, { id: 'b', name: 'Note', kind: 'text' }] };
    expect(sourceForTable(t)).toEqual({ table: 'b_t', x: 'Who', y: ['Note'] });
  });

  it('prefer the nearest table above, then any in the tab', () => {
    const table = (id) => ({ id, type: 'table', columns: [{ id: 'c', name: 'Vendor', kind: 'text' }, { id: 'd', name: 'Price', kind: 'number' }], rows: [] });
    const chart = { id: 'b_ch', type: 'chart', source: { table: 'b_gone', x: 'vendor', y: ['  PRICE '] } };
    expect(chartSourceTable(chart, { blocks: [table('b_a'), table('b_b'), chart] }).id).toBe('b_b');
    expect(chartSourceTable(chart, { blocks: [chart, table('b_c')] }).id).toBe('b_c');
    expect(chartSourceTable({ ...chart, source: { table: 'b_gone' } }, { blocks: [table('b_a')] })).toBeNull();
    expect(chartSourceTable({ ...chart, source: { x: 'Region', y: ['Price'] } }, { blocks: [table('b_a')] })).toBeNull();
  });
});

describe('applyLocal keeps blocks in shape', () => {
  const docOf = (blocks) => ({ schema: 'cowork.doc/1', id: 'd', title: 'D', rev: 1, tabs: [{ id: 't_1', title: 'D', blocks }] });
  const update = (block, set) => applyLocal(docOf([block]), [{ op: 'update', id: block.id, set }]).tabs[0].blocks[0];

  it('keeps a heading level from 1 to 3, defaulting to 2', () => {
    expect(update({ id: 'b', type: 'paragraph', text: 'x' }, { type: 'heading', level: 9 }).level).toBe(3);
    expect(update({ id: 'b', type: 'paragraph', text: 'x' }, { type: 'heading', level: 0 }).level).toBe(2);
    expect(update({ id: 'b', type: 'paragraph', text: 'x' }, { type: 'heading', level: -4 }).level).toBe(1);
  });

  it('keeps a list indent from 0 to 4, and drops it off a list', () => {
    expect(update({ id: 'b', type: 'bullet', indent: 1 }, { indent: 12 }).indent).toBe(4);
    expect(update({ id: 'b', type: 'bullet', indent: 1 }, { indent: -1 }).indent).toBe(0);
    expect(update({ id: 'b', type: 'bullet', indent: 1 }, { indent: 'x' }).indent).toBe(0);
    expect(update({ id: 'b', type: 'bullet', indent: 2 }, { type: 'paragraph' })).not.toHaveProperty('indent');
  });

  it('keeps done on to-dos only, as a boolean, and a level on headings only', () => {
    expect(update({ id: 'b', type: 'task', done: true }, { type: 'bullet' })).not.toHaveProperty('done');
    expect(update({ id: 'b', type: 'paragraph' }, { type: 'task' }).done).toBe(false);
    expect(update({ id: 'b', type: 'task', done: false }, { done: 1 }).done).toBe(true);
    expect(update({ id: 'b', type: 'heading', level: 2 }, { type: 'quote' })).not.toHaveProperty('level');
  });

  it('gives a new callout the info tone and keeps one it has', () => {
    expect(update({ id: 'b', type: 'paragraph' }, { type: 'callout' }).tone).toBe('info');
    expect(update({ id: 'b', type: 'callout', tone: 'danger' }, { text: 'x' }).tone).toBe('danger');
  });

  it('marks what the person changed as theirs', () => {
    expect(update({ id: 'b', type: 'paragraph', by: 'agent' }, { text: 'x' }).by).toBe('user');
  });

  it('adds a status a table update brings to its column\'s options', () => {
    const table = {
      id: 'b_t', type: 'table', columns: [{ id: 'c_s', name: 'Status', kind: 'status', options: [{ name: 'Done', tone: 'green' }] }],
      rows: [{ id: 'r_1', cells: { c_s: 'Done' } }],
    };
    const next = update(table, { rows: [{ id: 'r_1', cells: { c_s: 'done' } }, { id: 'r_2', cells: { c_s: 'Blocked' } }] });
    expect(next.columns[0].options).toEqual([{ name: 'Done', tone: 'green' }, { name: 'Blocked', tone: 'red' }]);
  });
});

describe('applyLocal table and tab ops', () => {
  it('adds rows at an index or the end, and deletes them', () => {
    const doc = sampleDoc();
    const added = applyLocal(doc, [
      { op: 'add_rows', table: 'b_2', rows: [{ id: 'r_0', cells: { c_a: 'Zed' } }], index: 1 },
      { op: 'add_rows', table: 'b_2', rows: [{ id: 'r_9', cells: {} }] },
    ]);
    expect(added.tabs[0].blocks[1].rows.map((r) => r.id)).toEqual(['r_0', 'r_1', 'r_2', 'r_9']);
    const deleted = applyLocal(added, [{ op: 'delete_rows', table: 'b_2', rows: ['r_1', 'r_9'] }]);
    expect(deleted.tabs[0].blocks[1].rows.map((r) => r.id)).toEqual(['r_0', 'r_2']);
    expect(applyLocal(doc, [{ op: 'add_rows', table: 'b_nope', rows: [{ id: 'r_8', cells: {} }] }])).toBeNull();
    expect(applyLocal(doc, [{ op: 'delete_rows', table: 'b_nope', rows: ['r_1'] }])).toBeNull();
  });

  it('updates a cell, and only one that is there', () => {
    const next = applyLocal(sampleDoc(), [{ op: 'update_cell', table: 'b_2', row: 'r_1', col: 'c_b', value: 9 }]);
    expect(next.tabs[0].blocks[1].rows[0].cells.c_b).toBe('9');
    expect(applyLocal(sampleDoc(), [{ op: 'update_cell', table: 'b_2', row: 'r_9', col: 'c_b', value: 1 }])).toBeNull();
    expect(applyLocal(sampleDoc(), [{ op: 'update_cell', table: 'b_2', row: 'r_1', col: 'c_z', value: 1 }])).toBeNull();
  });

  it('deletes a column, never the last one', () => {
    const next = applyLocal(sampleDoc(), [{ op: 'delete_column', table: 'b_2', col: 'c_a' }]);
    expect(next.tabs[0].blocks[1].columns.map((c) => c.id)).toEqual(['c_b']);
    expect(applyLocal(next, [{ op: 'delete_column', table: 'b_2', col: 'c_b' }])).toBeNull();
    expect(applyLocal(sampleDoc(), [{ op: 'delete_column', table: 'b_2', col: 'c_z' }])).toBeNull();
  });

  const twoTabs = () => {
    const doc = sampleDoc();
    doc.tabs.push({ id: 't_2', title: 'Notes', blocks: [] }, { id: 't_3', title: 'Later', blocks: [] });
    return doc;
  };

  it('moves a tab to a position counted from 1, as the server counts, kept in range', () => {
    expect(applyLocal(twoTabs(), [{ op: 'move_tab', tab: 't_3', index: 1 }]).tabs.map((t) => t.id)).toEqual(['t_3', 't_1', 't_2']);
    expect(applyLocal(twoTabs(), [{ op: 'move_tab', tab: 't_1', index: 2 }]).tabs.map((t) => t.id)).toEqual(['t_2', 't_1', 't_3']);
    expect(applyLocal(twoTabs(), [{ op: 'move_tab', tab: 't_1', index: 99 }]).tabs.map((t) => t.id)).toEqual(['t_2', 't_3', 't_1']);
    expect(applyLocal(twoTabs(), [{ op: 'move_tab', tab: 't_9', index: 1 }])).toBeNull();
  });

  it('counts an op\'s index from 1 (none or 0 is the end), as the server does', () => {
    expect([0, 1, 2].map(opIndex)).toEqual([1, 2, 3]);
    const at = (index) => applyLocal(sampleDoc(), [{ op: 'add_rows', table: 'b_2', rows: [{ id: 'r_n', cells: {} }], index }])
      .tabs[0].blocks[1].rows.map((r) => r.id).indexOf('r_n');
    expect([at(1), at(2), at(0), at(undefined), at(99)]).toEqual([0, 1, 2, 2, 2]);
  });

  it('deletes a tab, never the last one', () => {
    expect(applyLocal(twoTabs(), [{ op: 'delete_tab', tab: 't_2' }]).tabs.map((t) => t.id)).toEqual(['t_1', 't_3']);
    expect(applyLocal(sampleDoc(), [{ op: 'delete_tab', tab: 't_1' }])).toBeNull();
  });

  it('renames a tab', () => {
    expect(applyLocal(twoTabs(), [{ op: 'rename_tab', tab: 't_2', title: 'Notes v2' }]).tabs[1].title).toBe('Notes v2');
    expect(applyLocal(twoTabs(), [{ op: 'rename_tab', tab: 't_9', title: 'x' }])).toBeNull();
  });

  it('renames a doc with tabs without touching its tabs', () => {
    const next = applyLocal(twoTabs(), [{ op: 'rename_doc', title: 'Plan v2' }]);
    expect(next.title).toBe('Plan v2');
    expect(next.tabs[0].title).toBe('Plan');
  });

  it('applies ops to the tab the edit names, else to the first', () => {
    const block = { id: 'b_n', type: 'paragraph', text: 'n' };
    const next = applyLocal(twoTabs(), [{ op: 'insert', position: 'end', blocks: [block] }], { tab: 't_2' });
    expect(next.tabs[1].blocks.map((b) => b.id)).toEqual(['b_n']);
    expect(applyLocal(twoTabs(), [{ op: 'insert', position: 'end', blocks: [block] }]).tabs[0].blocks.at(-1).id).toBe('b_n');
    expect(applyLocal(twoTabs(), [{ op: 'insert', position: 'end', blocks: [block] }], { tab: 't_9' })).toBeNull();
  });

  it('inserts a block or a row only once, on a copy that already holds it', () => {
    // Found in review: an edit still waiting is replayed on each newer copy,
    // and one that already held its insert showed the block twice.
    const ops = [
      { op: 'insert', position: { after: 'b_1' }, blocks: [{ id: 'b_9', type: 'paragraph', text: 'New' }] },
      { op: 'add_rows', table: 'b_2', rows: [{ id: 'r_9', cells: {} }] },
    ];
    const once = applyLocal(sampleDoc(), ops);
    const twice = applyLocal(once, ops);
    expect(twice.tabs[0].blocks.map((b) => b.id)).toEqual(['b_1', 'b_9', 'b_2', 'b_3']);
    expect(twice.tabs[0].blocks[2].rows.map((r) => r.id)).toEqual(['r_1', 'r_2', 'r_9']);
  });

  it('gives up on a position or a move it cannot place', () => {
    expect(applyLocal(sampleDoc(), [{ op: 'insert', position: { after: 'b_nope' }, blocks: [] }])).toBeNull();
    expect(applyLocal(sampleDoc(), [{ op: 'insert', position: { weird: true }, blocks: [] }])).toBeNull();
    expect(applyLocal(sampleDoc(), [{ op: 'move', ids: ['b_1'], position: { before: 'b_nope' } }])).toBeNull();
  });
});

describe('block helpers', () => {
  it('tells text and list blocks apart', () => {
    expect(isTextBlock({ type: 'callout' })).toBe(true);
    expect(isTextBlock({ type: 'table' })).toBe(false);
    expect(isTextBlock(null)).toBe(false);
    expect(isListBlock({ type: 'task' })).toBe(true);
    expect(isListBlock({ type: 'quote' })).toBe(false);
  });

  it('makes each kind the editor can insert', () => {
    expect(makeBlock('heading')).toMatchObject({ type: 'heading', level: 2, text: '' });
    expect(makeBlock('numbered')).toMatchObject({ type: 'numbered', indent: 0 });
    expect(makeBlock('task')).toMatchObject({ type: 'task', done: false, indent: 0 });
    expect(makeBlock('callout')).toMatchObject({ type: 'callout', tone: 'info' });
    expect(makeBlock('code')).toMatchObject({ type: 'code', language: '', code: '' });
    expect(makeBlock('chart')).toMatchObject({ type: 'chart', chart: 'bar', series: [{ name: 'Value' }] });
    expect(makeBlock('metrics').items).toHaveLength(1);
    expect(makeBlock('quote', { text: 'q' })).toMatchObject({ type: 'quote', text: 'q' });
    expect(makeBlock('divider')).toEqual({ id: expect.any(String), type: 'divider' });
    expect(makeBlock('anything')).toMatchObject({ type: 'paragraph', text: '' });
  });

  it('quotes a block as plain words', () => {
    expect(blockPlainText({ type: 'paragraph', text: '**Bold** move' })).toBe('Bold move');
    expect(blockPlainText({ type: 'code', code: 'x = 1' })).toBe('x = 1');
    expect(blockPlainText(sampleDoc().tabs[0].blocks[1])).toBe('Table: Vendor, Price (2 rows)');
    expect(blockPlainText({ type: 'chart', title: 'Cost' })).toBe('Chart: Cost');
    expect(blockPlainText({ type: 'metrics', items: [{ label: 'ARR', value: '$4M' }] })).toBe('ARR $4M');
    expect(blockPlainText({ type: 'pending', intent: 'Risks' })).toBe('Risks');
    expect(blockPlainText({ type: 'divider' })).toBe('');
    expect(blockPlainText(null)).toBe('');
  });
});

describe('chart columns by name', () => {
  it('match whatever the case or spacing', () => {
    const tab = sampleDoc().tabs[0];
    const chart = { type: 'chart', source: { table: 'b_2', x: ' vendor ', y: ['PRICE', 'Missing'] } };
    expect(chartData(chart, tab)).toMatchObject({ labels: ['Acme', 'Beta'], series: [{ name: 'Price', values: [12000, 15500] }] });
    const spaced = { id: 'b_s', type: 'table', columns: [{ id: 'a', name: 'Unit  price', kind: 'number' }], rows: [{ id: 'r', cells: { a: '3' } }] };
    expect(chartData({ type: 'chart', source: { table: 'b_s', x: 'unit price', y: ['Unit price'] } }, { blocks: [spaced] }).series[0].values).toEqual([3]);
  });

  it('draw their own data when they have no source', () => {
    expect(chartData({ type: 'chart', x: ['a'], series: [{ name: 's', values: [1] }] }, null)).toEqual({ labels: ['a'], series: [{ name: 's', values: [1] }], table: null });
    expect(chartData({ type: 'chart' }, null)).toEqual({ labels: [], series: [], table: null });
  });
});

describe('more numbers, tones and dates', () => {
  it('takes a number as it is, and nothing as no number', () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber(Infinity)).toBeNull();
    expect(toNumber('1.5k')).toBe(1500);
    expect(toNumber(`1${'0'.repeat(400)}`)).toBeNull();
    expect(toNumber(null)).toBeNull();
  });

  it('finds a tone inside a longer status', () => {
    expect(toneFor('Blocked by legal')).toBe('red');
    expect(toneFor('')).toBe('gray');
    expect(toneFor(null)).toBe('gray');
  });

  it('leaves a date it cannot read alone', () => {
    expect(formatDate('2026-13-01')).toBe('2026-13-01');
    expect(formatDate(null)).toBe('');
  });
});



describe('dates', () => {
  // The same vectors as the server's to_iso_date (tests/test_docs_format.py).
  it.each([
    ['2026-11-04', '2026-11-04'],
    ['November 4, 2026', '2026-11-04'],
    ['Nov 4, 2026', '2026-11-04'],
    ['Nov. 4 2026', '2026-11-04'],
    ['Wednesday, November 4, 2026', '2026-11-04'],
    ['November 4th, 2026', '2026-11-04'],
    ['4 November 2026', '2026-11-04'],
    ['4 Nov, 2026', '2026-11-04'],
    ['**December 1, 2026**', '2026-12-01'],
    ['sept 30, 2026', '2026-09-30'],
    ['February 30, 2026', null],
    ['2026-13-01', null],
    ['11/04/2026', null],
    ['November 2026', null],
    ['next week', null],
    ['TBD', null],
    ['', null],
  ])('reads %j as %j', (text, iso) => { expect(toIsoDate(text)).toBe(iso); });

  it('stores a date typed into a date column as ISO, as the server does', () => {
    const d = {
      tabs: [{ id: 't_1', title: 'T', blocks: [{
        id: 'b_t', type: 'table', columns: [{ id: 'c_w', name: 'When', kind: 'date' }, { id: 'c_n', name: 'Note', kind: 'text' }],
        rows: [{ id: 'r_1', cells: { c_w: '', c_n: '' } }],
      }] }],
    };
    const next = applyLocal(d, [{ op: 'update_cell', table: 'b_t', row: 'r_1', col: 'c_w', value: 'Dec 3, 2026' },
      { op: 'update_cell', table: 'b_t', row: 'r_1', col: 'c_n', value: 'Dec 3, 2026' }]);
    expect(next.tabs[0].blocks[0].rows[0].cells).toEqual({ c_w: '2026-12-03', c_n: 'Dec 3, 2026' });
  });
});

describe('undo', () => {
  const tab = (blocks, title = 'Plan') => ({ id: 't_1', title, blocks });
  const p1 = { id: 'b_1', type: 'paragraph', text: 'One', v: 2, by: 'user' };
  const p2 = { id: 'b_2', type: 'paragraph', text: 'Two', v: 3, by: 'user' };

  it('puts a block first at the start', () => {
    const d = { tabs: [tab([p1])] };
    const next = applyLocal(d, [{ op: 'insert', position: 'start', blocks: [{ id: 'b_0', type: 'divider' }] }]);
    expect(next.tabs[0].blocks.map((b) => b.id)).toEqual(['b_0', 'b_1']);
  });

  it('applies while what it puts back reads as the write left it, whoever wrote since', () => {
    const after = { title: 'Plan', tabs: [tab([p1, p2])] };
    const entry = { after, ops: [{ op: 'replace', tab: 't_1', target: 'b_2', blocks: [{ ...p2, text: 'Was' }] },
      { op: 'insert', tab: 't_1', position: { after: 'b_2' }, blocks: [{ id: 'b_9', type: 'paragraph', text: 'Gone' }] },
      { op: 'rename_tab', tab: 't_1', title: 'Old' }] };
    // The agent wrote b_1 since: not this undo's business.
    expect(undoStillApplies({ title: 'Plan', tabs: [tab([{ ...p1, text: 'Agent', v: 9, by: 'agent' }, { ...p2, v: 3 }])] }, entry)).toBe(true);
    // The agent rewrote b_2: undoing would take that with it.
    expect(undoStillApplies({ title: 'Plan', tabs: [tab([p1, { ...p2, text: 'Agent' }])] }, entry)).toBe(false);
    // b_9 came back some other way, or the tab was renamed again.
    expect(undoStillApplies({ title: 'Plan', tabs: [tab([p1, p2, { id: 'b_9', type: 'paragraph', text: 'x' }])] }, entry)).toBe(false);
    expect(undoStillApplies({ title: 'Plan', tabs: [tab([p1, p2], 'Renamed')] }, entry)).toBe(false);
  });

  it('checks tabs and the title the same way', () => {
    const after = { title: 'New', tabs: [tab([p1]), { id: 't_2', title: 'Added', blocks: [] }] };
    const undo = { after, ops: [{ op: 'delete_tab', tab: 't_2' }, { op: 'rename_doc', title: 'Old' },
      { op: 'add_tab', id: 't_3', title: 'Deleted', blocks: [] }, { op: 'move', tab: 't_1', ids: ['b_1'], position: 'start' },
      { op: 'delete', tab: 't_1', target: ['b_1'] }, { op: 'move_tab', tab: 't_1', index: 1 }] };
    expect(undoStillApplies(after, undo)).toBe(true);
    expect(undoStillApplies({ ...after, title: 'Newer' }, undo)).toBe(false);
    expect(undoStillApplies({ ...after, tabs: [tab([p1])] }, undo)).toBe(false);
    expect(undoStillApplies({ ...after, tabs: [...after.tabs, { id: 't_3', title: 'Deleted', blocks: [] }] }, undo)).toBe(false);
  });
});
