// Task action menu — used in two places:
//   1. Sidebar RecentItem / pinned items (kebab click)
//   2. Chat header (with extra Schedule + Turn into skill items)
//
// This is a thin wrapper over the shared <Menu> primitive (ui/Menu.jsx,
// Base UI). It keeps the controlled `open` + `anchorRect` API the call
// sites already use, and just translates this menu's props into the
// primitive's item array — including the "Move to project" fly-out,
// which used to be ~150 lines of hand-rolled hover-corridor + flip math
// and is now a declarative `submenu`. Base UI owns positioning, Escape,
// click-outside, keyboard navigation, and submenu hover-intent.

import { Menu } from './ui';
import Ico from './Icons';

export function TaskMenu({
  task,
  projects = [],
  open,
  anchorRect,                 // {top, left, bottom, right} from trigger.getBoundingClientRect()
  align = 'right',
  onClose,
  onPin,
  onUnpin,
  onRename,
  onDelete,
  onMoveToProject,
  // Header-only extras:
  onSchedule,
  onTurnIntoSkill,
  showHeaderActions = false,
  hideMoveToProject = true,
  hideRename = true,
  agentLabel,
}) {
  const hasPinItem = !!(onPin || onUnpin);

  // Declarative item list — each row is conditional, falsy entries are
  // dropped by `.filter(Boolean)`. Dividers are sectioned the same way
  // so they only render when the section they separate is present.
  const items = [
    // Header-only extras (chat header), then a divider off the rest.
    showHeaderActions && { id: 'schedule', icon: Ico.schedule(14), label: 'Schedule', hint: 'WIP', onClick: onSchedule },
    showHeaderActions && { id: 'skill', icon: Ico.brain(14), label: 'Turn into skill', onClick: onTurnIntoSkill },
    showHeaderActions && { divider: true },

    // Move to project — opens a picker modal (search existing projects,
    // type a new name to create one, and choose whether to bring the
    // task's files + artifacts along).
    !hideMoveToProject && {
      id: 'move',
      icon: Ico.moveTo(14),
      label: 'Move to project…',
      onClick: () => onMoveToProject?.(),
    },
    !hideMoveToProject && { divider: true },

    hasPinItem && {
      id: 'pin',
      icon: Ico.pin(14),
      label: task?.pinned ? 'Unpin' : 'Pin',
      onClick: () => (task?.pinned ? onUnpin : onPin)?.(),
    },
    !hideRename && { id: 'rename', icon: Ico.edit(14), label: 'Rename', onClick: onRename },

    // Divider off Delete only when something precedes it.
    (!hideMoveToProject || !hideRename || hasPinItem) && { divider: true },

    { id: 'delete', icon: Ico.trash(14), label: 'Delete', danger: true, onClick: onDelete },
  ].filter(Boolean);

  return (
    <Menu
      open={open}
      anchor={anchorRect}
      onClose={onClose}
      align={align === 'left' ? 'start' : 'end'}
      width={220}
      zIndex={60}
      ariaLabel="Task actions"
      items={items}
    />
  );
}
