import { describe, expect, it } from 'vitest';
import {
  backspaceOps, blockLabel, deleteOps, enterOps, formatShortcut, indentOps, insertAboveOps, listNumbers, matchShortcut,
  pasteOps, placeFloat, slashAfterInput, slashItems, slashQuery, turnIntoSet,
} from './canvasOps';

const p = (id, text = '') => ({ id, type: 'paragraph', text });
const newBlock = { id: expect.stringMatching(/^b_/) };

describe('slash menu', () => {
  it('lists every block, the agent last when it can be asked', () => {
    const keys = slashItems('', true).map((i) => i.key);
    expect(keys.slice(0, 4)).toEqual(['paragraph', 'heading1', 'heading2', 'heading3']);
    expect(keys).toContain('table');
    expect(keys.at(-1)).toBe('ask');
    expect(slashItems('', false).map((i) => i.key)).not.toContain('ask');
  });

  it('filters on the label or the block type', () => {
    expect(slashItems(' TAB', false).map((i) => i.key)).toEqual(['table']);
    expect(slashItems('heading', false).map((i) => i.key)).toEqual(['heading1', 'heading2', 'heading3']);
    expect(slashItems('numbered', false).map((i) => i.label)).toEqual(['Numbered list']);
    expect(slashItems('zzz', true)).toEqual([]);
  });

  it('reads a command being typed, and nothing else', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/tab')).toBe('tab');
    expect(slashQuery('/two words')).toBeNull();
    expect(slashQuery('/' + 'x'.repeat(24))).toBeNull();
    expect(slashQuery('a/b')).toBeNull();
  });

  it('opens on "/", follows the query, and closes on anything else', () => {
    const open = slashAfterInput(null, 'b_1', '/ta');
    expect(open).toEqual({ blockId: 'b_1', query: 'ta', index: 0 });
    expect(slashAfterInput({ ...open, index: 3 }, 'b_1', '/tab')).toEqual({ blockId: 'b_1', query: 'tab', index: 0 });
    expect(slashAfterInput(open, 'b_1', 'tab ')).toBeNull();
    expect(slashAfterInput(null, 'b_1', 'words')).toBeNull();
  });

  it('leaves another block\'s menu alone', () => {
    const other = { blockId: 'b_2', query: '', index: 0 };
    expect(slashAfterInput(other, 'b_1', 'words')).toBe(other);
  });

  it('takes the first word typed into a menu opened from the + button', () => {
    const fromButton = { blockId: 'b_1', query: '', index: 0, fromButton: true };
    expect(slashAfterInput(fromButton, 'b_1', '')).toBe(fromButton);
    expect(slashAfterInput(fromButton, 'b_1', 'quo')).toEqual({ blockId: 'b_1', query: 'quo', index: 0, fromButton: false });
    expect(slashAfterInput(fromButton, 'b_1', '/to do').query).toBe('to do');
  });
});

describe('Markdown shortcuts', () => {
  it.each([
    ['# ', { type: 'heading', level: 1 }],
    ['## ', { type: 'heading', level: 2 }],
    ['### ', { type: 'heading', level: 3 }],
    ['- ', { type: 'bullet' }],
    ['+ ', { type: 'bullet' }],
    ['1. ', { type: 'numbered' }],
    ['1) ', { type: 'numbered' }],
    ['[] ', { type: 'task', done: false }],
    ['[ ] ', { type: 'task', done: false }],
    ['[X] ', { type: 'task', done: true }],
    ['> ', { type: 'quote' }],
  ])('"%s" starts its block', (marker, spec) => {
    expect(matchShortcut(`${marker}rest`, `${marker}**rest**`)).toEqual({ spec, at: marker.length, text: '**rest**' });
  });

  it('strips the escaped "*" the Markdown reads back', () => {
    expect(matchShortcut('* item', '\\* item')).toMatchObject({ spec: { type: 'bullet' }, at: 2, text: 'item' });
  });

  it('takes a non-breaking space for the space a browser types', () => {
    expect(matchShortcut('# ', '# ')).toMatchObject({ spec: { type: 'heading', level: 1 }, text: '' });
  });

  it('needs the marker at the start, then a space', () => {
    expect(matchShortcut('#heading', '#heading')).toBeNull();
    expect(matchShortcut('a # b', 'a # b')).toBeNull();
    expect(matchShortcut('2. two', '2. two')).toBeNull();
  });
});

describe('formatShortcut', () => {
  it('reads ⌘ or Ctrl with B, I, E, K and ⇧X', () => {
    expect(formatShortcut({ key: 'b', metaKey: true })).toBe('bold');
    expect(formatShortcut({ key: 'I', ctrlKey: true })).toBe('italic');
    expect(formatShortcut({ key: 'e', metaKey: true })).toBe('code');
    expect(formatShortcut({ key: 'k', metaKey: true })).toBe('link');
    expect(formatShortcut({ key: 'X', metaKey: true, shiftKey: true })).toBe('strike');
    expect(formatShortcut({ key: 'x', metaKey: true, shiftKey: true, altKey: true })).toBe('strike');
  });

  it('leaves every other key alone', () => {
    expect(formatShortcut({ key: 'b' })).toBeNull();
    expect(formatShortcut({ key: 'b', metaKey: true, shiftKey: true })).toBeNull();
    expect(formatShortcut({ key: 'b', metaKey: true, altKey: true })).toBeNull();
    expect(formatShortcut({ key: 'z', metaKey: true })).toBeNull();
  });
});

describe('pasteOps', () => {
  it('turns pasted lines into blocks, in place of an empty block or after a full one', () => {
    const md = '## Risks\n- Late';
    expect(pasteOps(p('b_1'), md, true)).toEqual([{ op: 'replace', target: 'b_1', markdown: md }]);
    expect(pasteOps(p('b_1', 'x'), md, false)).toEqual([{ op: 'insert', position: { after: 'b_1' }, markdown: md }]);
  });

  it('leaves one line to the editable', () => {
    expect(pasteOps(p('b_1'), 'one line', true)).toBeNull();
    expect(pasteOps(p('b_1'), 'one line\n\n  \n', true)).toBeNull();
  });
});

describe('turnIntoSet', () => {
  it('sets what the new kind needs', () => {
    expect(turnIntoSet(p('b'), { type: 'heading', level: 2 }, 'x')).toEqual({ type: 'heading', level: 2, text: 'x' });
    expect(turnIntoSet(p('b'), { type: 'task', done: true })).toEqual({ type: 'task', done: true });
    expect(turnIntoSet(p('b'), { type: 'task' })).toEqual({ type: 'task', done: false });
    expect(turnIntoSet(p('b'), { type: 'callout' })).toEqual({ type: 'callout', tone: 'info' });
    expect(turnIntoSet({ id: 'b', type: 'callout', tone: 'warning' }, { type: 'callout' })).toEqual({ type: 'callout', tone: 'warning' });
  });

  it('keeps the indent from one list kind to another, only', () => {
    expect(turnIntoSet({ id: 'b', type: 'bullet', indent: 2 }, { type: 'numbered' }, 'x')).toEqual({ type: 'numbered', text: 'x', indent: 2 });
    expect(turnIntoSet({ id: 'b', type: 'bullet' }, { type: 'task' })).toEqual({ type: 'task', done: false, indent: 0 });
    expect(turnIntoSet({ id: 'b', type: 'bullet', indent: 2 }, { type: 'paragraph' })).toEqual({ type: 'paragraph' });
    expect(turnIntoSet(p('b'), { type: 'bullet' })).toEqual({ type: 'bullet' });
  });
});

describe('insertAboveOps', () => {
  it('puts the block above and clears the typed command', () => {
    expect(insertAboveOps(p('b_1', '/tab'), 'table')).toEqual({
      ops: [
        { op: 'insert', position: { before: 'b_1' }, blocks: [expect.objectContaining({ ...newBlock, type: 'table' })] },
        { op: 'update', id: 'b_1', set: { text: '' } },
      ],
      write: { id: 'b_1', text: '' },
      focus: { id: 'b_1', where: 'start' },
    });
  });

  it('sends no update for a line with nothing saved in it yet', () => {
    expect(insertAboveOps(p('b_1'), 'divider').ops).toEqual([
      { op: 'insert', position: { before: 'b_1' }, blocks: [{ ...newBlock, type: 'divider' }] },
    ]);
  });
});

describe('enterOps', () => {
  it('splits a paragraph at the caret and moves to the new half', () => {
    const r = enterOps(p('b_1', 'Hello world'), { before: 'Hello', after: ' world' });
    expect(r.ops).toEqual([
      { op: 'update', id: 'b_1', set: { text: 'Hello' } },
      { op: 'insert', position: { after: 'b_1' }, blocks: [{ ...newBlock, type: 'paragraph', text: ' world' }] },
    ]);
    expect(r.write).toEqual({ id: 'b_1', text: 'Hello' });
    expect(r.focus).toEqual({ id: r.ops[1].blocks[0].id, where: 'start' });
  });

  it('continues a list at the same indent', () => {
    const r = enterOps({ id: 'b_1', type: 'task', text: 'a', indent: 1, done: true }, { before: 'a', after: '' });
    expect(r.ops[1].blocks[0]).toMatchObject({ type: 'task', indent: 1, done: false, text: '' });
    expect(enterOps({ id: 'b_2', type: 'bullet', text: 'a' }, { before: 'a', after: '' }).ops[1].blocks[0].indent).toBe(0);
  });

  it('opens a line above when the caret is at the start, keeping the caret', () => {
    const r = enterOps(p('b_1', 'Hi'), { before: '', after: 'Hi' });
    expect(r.ops).toEqual([{ op: 'insert', position: { before: 'b_1' }, blocks: [{ ...newBlock, type: 'paragraph', text: '' }] }]);
    expect(r.focus).toEqual({ id: 'b_1', where: 'start' });
    expect(r.write).toBeUndefined();
  });

  it('opens a paragraph, not a heading, above a heading', () => {
    const r = enterOps({ id: 'b_1', type: 'heading', level: 2, text: 'Hi' }, { before: '', after: 'Hi' });
    expect(r.ops[0].blocks[0].type).toBe('paragraph');
  });

  it('steps out of an empty list item a level at a time, then out of the list', () => {
    expect(enterOps({ id: 'b_1', type: 'bullet', text: '', indent: 2 }, { before: '', after: '' }).ops)
      .toEqual([{ op: 'update', id: 'b_1', set: { indent: 1, text: '' } }]);
    expect(enterOps({ id: 'b_1', type: 'bullet', text: '', indent: 0 }, { before: '', after: '' }))
      .toEqual({ ops: [{ op: 'update', id: 'b_1', set: { type: 'paragraph', text: '' } }], focus: { id: 'b_1', where: 'start' } });
  });

  it('adds a paragraph after an empty paragraph', () => {
    const r = enterOps(p('b_1'), { before: '', after: '' });
    expect(r.ops[1]).toMatchObject({ op: 'insert', position: { after: 'b_1' } });
  });
});

describe('backspaceOps', () => {
  it('unwraps a block before joining it to anything', () => {
    expect(backspaceOps([{ id: 'b_1', type: 'heading', level: 1, text: 'H' }], 0, 'H'))
      .toEqual({ ops: [{ op: 'update', id: 'b_1', set: { type: 'paragraph', text: 'H' } }], focus: { id: 'b_1', where: 'start' } });
    expect(backspaceOps([{ id: 'b_1', type: 'bullet', indent: 1, text: 'x' }], 0, 'x').ops)
      .toEqual([{ op: 'update', id: 'b_1', set: { indent: 0, text: 'x' } }]);
    expect(backspaceOps([{ id: 'b_1', type: 'bullet', indent: 0, text: 'x' }], 0, 'x').ops)
      .toEqual([{ op: 'update', id: 'b_1', set: { type: 'paragraph', text: 'x' } }]);
  });

  it('joins a paragraph to the text above, caret at the seam', () => {
    expect(backspaceOps([p('b_1', '**One**'), p('b_2', 'Two')], 1, 'Two')).toEqual({
      ops: [{ op: 'update', id: 'b_1', set: { text: '**One**Two' } }, { op: 'delete', target: ['b_2'] }],
      write: { id: 'b_1', text: '**One**Two' },
      focus: { id: 'b_1', where: 3 },
    });
  });

  it('joins onto an empty block above', () => {
    expect(backspaceOps([{ id: 'b_1', type: 'quote' }, p('b_2', 'Two')], 1, 'Two').write).toEqual({ id: 'b_1', text: 'Two' });
  });

  it('removes an empty line under a table and goes up to the last text', () => {
    const blocks = [p('b_0', 'Lead'), { id: 'b_t', type: 'table', columns: [], rows: [] }, p('b_1')];
    expect(backspaceOps(blocks, 2, '')).toEqual({ ops: [{ op: 'delete', target: ['b_1'] }], focus: { id: 'b_0', where: 'end' } });
    expect(backspaceOps(blocks.slice(1), 1, '')).toEqual({ ops: [{ op: 'delete', target: ['b_1'] }], focus: null });
  });

  it('leaves the first paragraph, and words under a table, to the browser', () => {
    expect(backspaceOps([p('b_1', 'x')], 0, 'x')).toBeNull();
    expect(backspaceOps([{ id: 'b_t', type: 'chart' }, p('b_1', 'x')], 1, 'x')).toBeNull();
  });
});

describe('deleteOps', () => {
  it('pulls the next text block up', () => {
    expect(deleteOps([p('b_1', 'One'), { id: 'b_2', type: 'quote', text: '*Two*' }], 0, 'One')).toEqual({
      ops: [{ op: 'update', id: 'b_1', set: { text: 'One*Two*' } }, { op: 'delete', target: ['b_2'] }],
      write: { id: 'b_1', text: 'One*Two*' },
      focus: { id: 'b_1', where: 3 },
    });
  });

  it('stops at the last block and at anything but text', () => {
    expect(deleteOps([p('b_1', 'x')], 0, 'x')).toBeNull();
    expect(deleteOps([p('b_1', 'x'), { id: 'b_2', type: 'divider' }], 0, 'x')).toBeNull();
  });

  it('joins an empty next block', () => {
    expect(deleteOps([p('b_1', 'x'), { id: 'b_2', type: 'paragraph' }], 0, 'x').ops[0].set.text).toBe('x');
  });
});

describe('indentOps', () => {
  it('indents between 0 and 4', () => {
    expect(indentOps({ id: 'b', type: 'bullet' }, 1, 'x')).toEqual([{ op: 'update', id: 'b', set: { indent: 1, text: 'x' } }]);
    expect(indentOps({ id: 'b', type: 'bullet', indent: 4 }, 1, 'x')).toBeNull();
    expect(indentOps({ id: 'b', type: 'bullet', indent: 0 }, -1, 'x')).toBeNull();
    expect(indentOps({ id: 'b', type: 'bullet', indent: 3 }, -1, 'x')[0].set.indent).toBe(2);
  });
});

describe('listNumbers', () => {
  it('counts each level and restarts after anything that is not a list', () => {
    const n = (id, indent = 0) => ({ id, type: 'numbered', indent });
    expect(listNumbers([
      n('a'), n('b'), n('b1', 1), n('b2', 1), n('c'),
      { id: 'x', type: 'bullet' }, n('d'),
      p('break'), n('e'),
    ])).toEqual({ a: 1, b: 2, b1: 1, b2: 2, c: 3, d: 1, e: 1 });
  });
});

describe('blockLabel', () => {
  it('names a block by its kind and first words', () => {
    expect(blockLabel({ id: 'b', type: 'heading', level: 2, text: 'Risks' })).toBe('Heading 2 “Risks”');
    expect(blockLabel({ id: 'b', type: 'heading', text: 'Risks' })).toBe('Heading 2 “Risks”');
    expect(blockLabel({ id: 'b', type: 'task', text: 'Sign **by** Friday' })).toBe('To-do “Sign by Friday”');
    expect(blockLabel(p('b', 'x'.repeat(60)))).toBe(`Paragraph “${'x'.repeat(39)}…”`);
    expect(blockLabel({ id: 'b', type: 'chart', title: 'Cost' })).toBe('Chart “Cost”');
    expect(blockLabel({ id: 'b', type: 'pending', intent: 'Risks to cover' })).toBe('Section to write “Risks to cover”');
  });

  it('says when a text block is empty, and names other blocks by kind', () => {
    expect(blockLabel(p('b'))).toBe('Empty paragraph');
    expect(blockLabel({ id: 'b', type: 'table', columns: [], rows: [] })).toBe('Table');
    expect(blockLabel({ id: 'b', type: 'chart' })).toBe('Chart');
    expect(blockLabel({ id: 'b', type: 'mystery' })).toBe('Block');
  });
});

describe('placeFloat', () => {
  const viewport = { width: 1000, height: 800 };
  const rect = { top: 100, bottom: 120, left: 200, width: 80 };

  it('sits below the rect at its left edge', () => {
    expect(placeFloat(rect, { width: 264, height: 300, gap: 6 }, viewport)).toEqual({ top: 126, left: 200 });
  });

  it('sits above the rect, centred on it', () => {
    expect(placeFloat(rect, { width: 300, height: 36, gap: 8, side: 'above', align: 'center' }, viewport))
      .toEqual({ top: 56, left: 90 });
  });

  it('stays inside the viewport on every side', () => {
    expect(placeFloat({ top: 760, bottom: 780, left: 900, width: 0 }, { width: 264, height: 300 }, viewport))
      .toEqual({ top: 492, left: 728 });
    expect(placeFloat({ top: 10, bottom: 30, left: -50, width: 0 }, { width: 300, height: 36, side: 'above', align: 'center' }, viewport))
      .toEqual({ top: 8, left: 8 });
  });

  it('keeps the margin when the viewport is smaller than the popover', () => {
    expect(placeFloat(rect, { width: 2000, height: 2000 }, viewport)).toEqual({ top: 8, left: 8 });
  });

  it('defaults to a point-sized popover', () => {
    expect(placeFloat(rect, {}, viewport)).toEqual({ top: 126, left: 200 });
  });
});
