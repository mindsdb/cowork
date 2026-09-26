import { useState } from 'react';
import { GitBranch } from 'lucide-react';
import Combobox from '../components/ui/Combobox';
import { codingApi } from './api';

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
        reason instanceof Error ? reason.message : 'Could not load branches. Open the picker to retry.',
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
        ariaLabel={`Start ${name} from`}
        size="sm"
        value={value}
        groups={[
          {
            key: 'branches',
            name: null,
            items: options.map((branch) => ({ value: branch, label: branch, icon: <GitBranch size={13} /> })),
          },
        ]}
        placeholder="Default branch"
        searchPlaceholder="Find a branch…"
        menuLabel="Start from"
        loading={loading}
        disabled={disabled}
        onOpenChange={(open) => void load(open)}
        onValueChange={onChange}
      />
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
