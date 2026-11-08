// The handles in the page margin beside a block: add a block below it, and its
// options menu (turn into, colour, ask the agent, duplicate, move, delete),
// whose options blockMenu decides.
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui';
import { BLOCK_ICONS, TONE_ICONS } from './blockIcons';
import { blockMenu } from './blockMenu';

const ICONS = { ...BLOCK_ICONS, ...TONE_ICONS, dup: Copy, up: ArrowUp, down: ArrowDown, del: Trash2 };

/** blockMenu's options as the Menu draws them: each with its icon, choosing it through `act`. */
function drawn(options, act) {
  return options.map(({ ops, turnInto, ask, submenu, ...item }) => ({
    ...item,
    ...(ICONS[item.key] ? { icon: <Icon of={ICONS[item.key]} size={14} /> } : {}),
    ...(submenu ? { submenu: drawn(submenu, act) } : {}),
    ...(ops || turnInto || ask ? { onClick: () => act({ ops, turnInto, ask }) } : {}),
  }));
}

/**
 * The options for `blocks[index]`. `readText` is its text as typed so far,
 * `turnInto(spec, text)` converts it, `askAgent` (when the agent can be
 * asked) opens "Edit with agent" on it.
 */
export function blockMenuItems({ blocks, index, onOps, readText, turnInto, askAgent }) {
  return drawn(blockMenu(blocks, index, { canAsk: !!askAgent }), (chosen) => {
    if (chosen.ops) onOps(chosen.ops);
    else if (chosen.turnInto) turnInto(chosen.turnInto, readText());
    else askAgent();
  });
}

/** `label` names the block for its buttons ("Heading 2 “Risks”"). */
export default function BlockGutter({ label, open, onOpenChange, onAdd, items }) {
  return (
    <div className="doc-gutter" data-open={open}>
      <button type="button" className="doc-gutter__btn" aria-label={`Add a block below ${label}`} onClick={onAdd}>
        <Icon of={Plus} size={14} />
      </button>
      <Menu
        open={open}
        onOpenChange={onOpenChange}
        ariaLabel="Block options"
        trigger={<button type="button" className="doc-gutter__btn" aria-label={`Options for ${label}`}><Icon of={GripVertical} size={14} /></button>}
        items={items}
      />
    </div>
  );
}
