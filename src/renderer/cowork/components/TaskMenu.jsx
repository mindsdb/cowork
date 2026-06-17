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

  // Projects this task isn't already in — the destinations for "Move to".
  const moveCandidates = projects.filter(
    (p) => p.name !== task?.projectName && p.path !== task?.projectPath,
  );

  // Declarative item list — each row is conditional, falsy entries are
  // dropped by `.filter(Boolean)`. Dividers are sectioned the same way
  // so they only render when the section they separate is present.
  const items = [
    // Header-only extras (chat header), then a divider off the rest.
    showHeaderActions && { id: 'schedule', icon: Ico.schedule(14), label: 'Schedule', hint: 'WIP', onClick: onSchedule },
    showHeaderActions && { id: 'skill', icon: Ico.brain(14), label: 'Turn into skill', onClick: onTurnIntoSkill },
    showHeaderActions && { divider: true },

    // Move to project — a fly-out of destinations, or disabled with the
    // reason in a tooltip when there's nowhere to move it (the legacy
    // menu spelled it out in a sub-panel; a title keeps the row clean).
    !hideMoveToProject && (
      moveCandidates.length
        ? {
            id: 'move',
            icon: Ico.moveTo(14),
            label: 'Move to project',
            submenu: moveCandidates.map((p) => ({
              id: p.name,
              label: p.name,
              onClick: () => onMoveToProject?.(p),
            })),
          }
        : {
            id: 'move',
            icon: Ico.moveTo(14),
            label: 'Move to project',
            disabled: true,
            title: projects.length === 0
              ? `No projects available — ${agentLabel} is still loading them.`
              : 'Create another project first to move this task.',
          }
    ),
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
