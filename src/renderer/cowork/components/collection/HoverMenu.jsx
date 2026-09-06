import { Menu } from '../ui';

export function HoverMenu({ open, anchorRect, onClose, items = [], width = 200 }) {
  return (
    <Menu
      open={open}
      anchor={anchorRect}
      onClose={onClose}
      align="end"
      width={width}
      zIndex={60}
      items={items}
    />
  );
}
