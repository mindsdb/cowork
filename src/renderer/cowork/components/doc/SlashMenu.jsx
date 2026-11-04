// The "/" menu under a block: blocks to insert or to turn the line into. The
// block keeps the focus and drives it (arrows, Enter, Escape; see DocCanvas).
import { Icon } from '../ui/Icon';
import FloatPanel from './FloatPanel';
import { BLOCK_ICONS } from './blockIcons';

export const slashOptionId = (menuId, index) => `${menuId}-${index}`;

export default function SlashMenu({ id, items, query, index, rect, onHover, onPick }) {
  return (
    <FloatPanel id={id} rect={rect} gap={6} className="doc-slash" role="listbox" aria-label="Insert a block"
      onMouseDown={(e) => e.preventDefault()}>
      {items.length === 0 && <div className="doc-slash__empty">No blocks match “{query}”</div>}
      {items.map((it, idx) => (
        <div key={it.key}>
          {(idx === 0 || items[idx - 1].group !== it.group) && <div className="doc-slash__group">{it.group}</div>}
          <button type="button" id={slashOptionId(id, idx)} className="doc-slash__item" role="option"
            aria-selected={idx === index} data-active={idx === index}
            onMouseEnter={() => onHover(idx)} onClick={() => onPick(it)}>
            <span className="doc-slash__icon"><Icon of={BLOCK_ICONS[it.key]} size={16} /></span>
            {it.label}
            {it.hint && <span className="doc-slash__hint">{it.hint}</span>}
          </button>
        </div>
      ))}
    </FloatPanel>
  );
}
