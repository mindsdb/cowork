import Ico from '../components/Icons';

// Shared by the project list rows and the project page header.
export function projectActions(id: string, onEdit: (id: string) => void, onDelete: (id: string) => void) {
  return [
    { label: 'Project settings', icon: Ico.settings(14), onClick: () => onEdit(id) },
    { divider: true },
    { label: 'Delete project', icon: Ico.trash(14), danger: true, onClick: () => onDelete(id) },
  ];
}
