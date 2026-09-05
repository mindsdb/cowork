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
  onSchedule,
  onTurnIntoSkill,
  showHeaderActions = false,
  hideMoveToProject = true,
  hideRename = true,
  agentLabel,
}) {
  const hasPinItem = !!(onPin || onUnpin);

  const items = [
    showHeaderActions && { id: 'schedule', icon: Ico.schedule(14), label: 'Schedule', hint: 'WIP', onClick: onSchedule },
    showHeaderActions && { id: 'skill', icon: Ico.brain(14), label: 'Turn into skill', onClick: onTurnIntoSkill },
    showHeaderActions && { divider: true },

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
