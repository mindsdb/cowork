import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, Folder } from 'lucide-react';
import Button from '../components/ui/Button';
import { codingApi, type CodeComputer, type ProjectResource, type ProjectResourceState } from './api';
import {
  emptyRepositorySetup,
  type RepositoryStatus,
  type TaskRepositorySetup,
} from './repositorySetupModels';
import { TaskRepositoryDrawer } from './TaskRepositoryDrawer';

export function TaskRepositoriesControl({
  projectId,
  resources,
  selectedIds,
  setup,
  local,
  disabled,
  resourceStates = [],
  computers = [],
  onApply,
}: {
  projectId: string;
  resources: ProjectResource[];
  selectedIds: string[];
  setup?: TaskRepositorySetup;
  local: boolean;
  disabled?: boolean;
  onApply: (ids: string[], setup: TaskRepositorySetup | undefined) => void;
  resourceStates?: ProjectResourceState[];
  computers?: CodeComputer[];
}) {
  const [open, setOpen] = useState(false);
  const [statuses, setStatuses] = useState<RepositoryStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [leftOffset, setLeftOffset] = useState(0);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !local) return;
    let active = true;
    setLoading(true);
    setError('');
    codingApi
      .repositoryStatus(projectId)
      .then((page) => {
        if (active) setStatuses(page.items);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : 'Could not check repositories. Refresh to try again.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, open, local, revision]);
  const hasChanges =
    local && statuses.some((status) => selectedIds.includes(status.resource_id) && status.change_count > 0);
  return (
    <div ref={anchor}>
      <Button
        variant="subtle"
        size="sm"
        className="code-repositories-launcher"
        aria-label="Repositories and folders"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setLeftOffset(anchor.current?.closest('.code-new-task')?.getBoundingClientRect().left || 0);
          setOpen(true);
        }}
      >
        <Folder size={13} />
        <span>
          {selectedIds.length} {selectedIds.length === 1 ? 'resource' : 'resources'}
        </span>
        {hasChanges && (
          <AlertCircle size={13} className="code-repositories-launcher__warning" aria-label="Local changes" />
        )}
        <ChevronDown size={12} />
      </Button>
      {open && (
        <TaskRepositoryDrawer
          projectId={projectId}
          resources={resources}
          resourceStates={resourceStates}
          computers={computers}
          statusRevision={revision}
          selectedIds={selectedIds}
          setup={setup || emptyRepositorySetup()}
          statuses={statuses}
          loading={loading}
          error={error}
          local={local}
          leftOffset={leftOffset}
          onRefresh={() => setRevision((value) => value + 1)}
          onClose={() => setOpen(false)}
          onApply={(ids, value) => {
            onApply(ids, local ? value : undefined);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
