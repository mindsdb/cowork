// Shared dropdown menu for collection cards (projects, artifacts, …).
//
// This is now a thin wrapper over the shared <Menu> primitive
// (ui/Menu.jsx, Base UI). It keeps the controlled `open` + `anchorRect`
// API the collection views already use, so call sites are unchanged.
//
// Why a shared component (still true):
//   • Same hover-then-kebab pattern across collection pages → users
//     learn the affordance once.
//   • Positioning, flip-when-no-room, click-outside and Escape are all
//     handled once (now by Base UI) instead of being re-derived per view
//     and drifting (tested in Projects → broken in Artifacts).
//
// Note on mounting: the legacy version REQUIRED being rendered at the
// page level rather than inside the card, because a card's hover
// `transform` becomes the containing block for `position: fixed`
// descendants and would mis-anchor the menu. Base UI's positioner
// portals to <body>, so that constraint no longer applies — but the
// page-level shared-state pattern below is kept as-is to avoid churning
// the call sites.
//
// Usage (parent owns the menu state, cards just request it):
//
//   const [menuFor, setMenuFor] = useState(null); // { item, rect }
//   <Card onMenuOpen={(item, rect) => setMenuFor({ item, rect })} />
//   <HoverMenu
//     open={!!menuFor}
//     anchorRect={menuFor?.rect}
//     onClose={() => setMenuFor(null)}
//     items={[
//       { id: 'publish',  label: 'Publish',  icon: <…/>, onClick: () => … },
//       { separator: true },
//       { id: 'delete',   label: 'Delete',   icon: <…/>, danger: true,
//         onClick: () => … },
//     ]}
//   />

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
