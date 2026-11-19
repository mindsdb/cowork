import { useState } from 'react';
import { GitBranch } from 'lucide-react';
import { Icon } from '../components/ui/Icon';
import Combobox from '../components/ui/Combobox';
import { codingApi } from './api';
import { useTranslation } from '../../lib/i18n';

export function RepositoryBranchSelect({
  projectId,
  resourceId,
  name,
  value,
  branches,
  local,
  disabled,
  onChange,
  onBranchesLoaded,
}: {
  projectId: string;
  resourceId: string;
  name: string;
  value: string;
  branches: string[];
  local: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onBranchesLoaded: (branches: string[]) => void;
}) {
  const { t } = useTranslation('code');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = async (open: boolean) => {
    if (!open || local || loading) return;
    setLoading(true);
    setError('');
    try {
      onBranchesLoaded((await codingApi.repositoryBranches(projectId, resourceId)).items);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t('branchSelect.loadFailed'),
      );
    } finally {
      setLoading(false);
    }
  };
  const options = [...new Set([...(value ? [value] : []), ...branches])].filter(
    (branch) => !branch.endsWith('/HEAD'),
  );
  return (
    <div className="code-repository-base">
      <Combobox
        ariaLabel={t('branchSelect.ariaLabel', { name })}
        size="sm"
        value={value}
        groups={[
          {
            key: 'branches',
            name: null,
            items: options.map((branch) => ({ value: branch, label: branch, icon: <Icon of={GitBranch} size={14} /> })),
          },
        ]}
        placeholder={t('branchSelect.placeholder')}
        searchPlaceholder={t('branchSelect.searchPlaceholder')}
        menuLabel={t('branchSelect.menuLabel')}
        loading={loading}
        disabled={disabled}
        onOpenChange={(open) => void load(open)}
        onValueChange={onChange}
      />
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
