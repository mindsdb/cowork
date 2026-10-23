// The options menu beside a block: what it offers each block, and the ops
// each option sends.
import { describe, expect, it } from 'vitest';
import { blockMenu } from './blockMenu';
import { CALLOUT_TONES, TURN_INTO } from './canvasOps';

const blocks = [
  { id: 'b_1', type: 'heading', level: 2, text: 'Risks' },
  { id: 'b_2', type: 'callout', tone: 'info', text: 'Watch the spend' },
  { id: 'b_3', type: 'table', columns: [{ id: 'c_1', name: 'Name', kind: 'text' }], rows: [{ id: 'r_1', cells: { c_1: 'A' } }] },
];
const keys = (items) => items.map((it) => it.key ?? '—');
const option = (items, key) => items.find((it) => it.key === key);

describe('blockMenu', () => {
  it('offers a text block every kind to turn into, and the agent only when it can be asked', () => {
    const items = blockMenu(blocks, 0, { canAsk: true });
    expect(keys(items)).toEqual(['turn', 'ask', '—', 'dup', 'down', '—', 'del']);
    expect(option(items, 'turn').submenu.map((t) => t.turnInto)).toEqual(TURN_INTO);
    expect(option(items, 'ask')).toMatchObject({ label: 'Edit with agent…', ask: true });
    expect(keys(blockMenu(blocks, 0))).not.toContain('ask');
  });

  it('offers a callout its colours, each an update of its tone', () => {
    const tone = option(blockMenu(blocks, 1), 'tone');
    expect(tone.submenu.map((t) => t.label)).toEqual(CALLOUT_TONES.map((t) => t.label));
    expect(option(tone.submenu, 'danger').ops).toEqual([{ op: 'update', id: 'b_2', set: { tone: 'danger' } }]);
  });

  it('offers a block that holds no text neither turning into nor colours', () => {
    expect(keys(blockMenu(blocks, 2))).toEqual(['—', 'dup', 'up', '—', 'del']);
  });

  it('moves a block above the one before it, or below the one after it, and only where there is one', () => {
    const middle = blockMenu(blocks, 1);
    expect(option(middle, 'up').ops).toEqual([{ op: 'move', ids: ['b_2'], position: { before: 'b_1' } }]);
    expect(option(middle, 'down').ops).toEqual([{ op: 'move', ids: ['b_2'], position: { after: 'b_3' } }]);
    expect(option(blockMenu(blocks, 0), 'up')).toBeUndefined();
    expect(option(blockMenu(blocks, 2), 'down')).toBeUndefined();
  });

  it('deletes the block', () => {
    expect(option(blockMenu(blocks, 2), 'del')).toMatchObject({ danger: true, ops: [{ op: 'delete', target: ['b_3'] }] });
  });

  it('duplicates the block below it, as a copy of its own under a new id', () => {
    const [insert] = option(blockMenu(blocks, 2), 'dup').ops;
    expect(insert).toMatchObject({ op: 'insert', position: { after: 'b_3' } });
    const [copy] = insert.blocks;
    expect(copy.id).toMatch(/^b_[a-z0-9]{8}$/);
    expect(copy).toEqual({ ...blocks[2], id: copy.id });
    copy.rows[0].cells.c_1 = 'B';
    expect(blocks[2].rows[0].cells.c_1).toBe('A');
  });

  it('leaves the server\'s stamps on the original, not on its copy', () => {
    // Found in review: the copy carried the original's rev and author.
    const stamped = [{ id: 'b_1', type: 'paragraph', text: 'Lead', v: 7, by: 'agent' }];
    const [copy] = option(blockMenu(stamped, 0), 'dup').ops[0].blocks;
    expect(copy).toEqual({ id: copy.id, type: 'paragraph', text: 'Lead' });
  });
});
