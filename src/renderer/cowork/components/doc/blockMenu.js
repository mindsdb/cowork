// The options menu beside a block, decided without React: which options it
// offers, and what each does. BlockGutter draws it, with the icons.
import { CALLOUT_TONES, TURN_INTO } from './canvasOps';
import { isTextBlock, newId } from './docModel';

/**
 * The options for `blocks[i]`, each a `key` and `label` and what choosing it
 * does: `ops` to send, a TURN_INTO spec to `turnInto`, or `ask` (offered only
 * with `canAsk`) to open "Edit with agent" on it. `{ divider: true }` between
 * groups.
 */
export function blockMenu(blocks, i, { canAsk = false } = {}) {
  const b = blocks[i];
  const items = [];
  if (isTextBlock(b)) {
    items.push({ key: 'turn', label: 'Turn into', submenu: TURN_INTO.map((t) => ({ key: t.key, label: t.label, turnInto: t })) });
  }
  if (b.type === 'callout') {
    items.push({
      key: 'tone', label: 'Callout color', submenu: CALLOUT_TONES.map((t) => ({
        key: t.tone, label: t.label, ops: [{ op: 'update', id: b.id, set: { tone: t.tone } }],
      })),
    });
  }
  if (canAsk) items.push({ key: 'ask', label: 'Edit with agent…', ask: true });
  items.push({ divider: true });
  // A copy is a new block: the server's stamps (the rev it was last written
  // at, and by whom) are the original's, not its.
  const { v: _rev, by: _by, ...copy } = structuredClone(b);
  items.push({
    key: 'dup', label: 'Duplicate',
    ops: [{ op: 'insert', position: { after: b.id }, blocks: [{ ...copy, id: newId('b_') }] }],
  });
  if (i > 0) items.push({ key: 'up', label: 'Move up', ops: [{ op: 'move', ids: [b.id], position: { before: blocks[i - 1].id } }] });
  if (i < blocks.length - 1) {
    items.push({ key: 'down', label: 'Move down', ops: [{ op: 'move', ids: [b.id], position: { after: blocks[i + 1].id } }] });
  }
  items.push({ divider: true });
  items.push({ key: 'del', label: 'Delete', danger: true, ops: [{ op: 'delete', target: [b.id] }] });
  return items;
}
