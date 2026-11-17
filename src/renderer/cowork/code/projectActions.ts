import Ico from '../components/Icons';
import i18n from '../../lib/i18n';

// Shared by the project list rows and the project page header.
export function projectActions(id: string, onEdit: (id: string) => void, onDelete: (id: string) => void) {
  return [
    { label: i18n.t('projectActions.settings', { ns: 'code' }), icon: Ico.settings(14), onClick: () => onEdit(id) },
    { divider: true },
    { label: i18n.t('projectActions.delete', { ns: 'code' }), icon: Ico.trash(14), danger: true, onClick: () => onDelete(id) },
  ];
}
