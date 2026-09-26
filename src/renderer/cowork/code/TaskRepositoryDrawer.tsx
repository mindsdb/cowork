import { useEffect, useId, useState } from 'react';
import { GitBranch, Folder, RefreshCw, ShieldCheck } from 'lucide-react';
import Button from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import Alert from '../components/ui/Alert';
import { Input } from '../components/ui/Input';
import Spinner from '../components/ui/Spinner';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import type { CodeComputer, ProjectResource, ProjectResourceState } from './api';
import { RepositoryLocalChanges } from './RepositoryLocalChanges';
import { RepositoryBranchSelect } from './RepositoryBranchSelect';
import { branchNameIssue, type RepositoryStatus, type TaskRepositorySetup } from './repositorySetupModels';
import './task-repositories.css';

export function TaskRepositoryDrawer({
  projectId,
  resources,
  resourceStates,
  computers,
  statusRevision,
  selectedIds,
  setup,
  statuses,
  loading,
  error,
  local,
  leftOffset,
  onRefresh,
  onApply,
  onClose,
}: {
  projectId: string;
  resources: ProjectResource[];
  selectedIds: string[];
  setup: TaskRepositorySetup;
  statuses: RepositoryStatus[];
  loading: boolean;
  error: string;
  local: boolean;
  leftOffset: number;
  resourceStates: ProjectResourceState[];
  computers: CodeComputer[];
  statusRevision: number;
  onRefresh: () => void;
  onApply: (ids: string[], setup: TaskRepositorySetup) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const branchId = useId();
  const [ids, setIds] = useState(selectedIds);
  const [draft, setDraft] = useState(setup);
  const byId = new Map(statuses.map((status) => [status.resource_id, status]));
  const availability = new Map(resourceStates.map((item) => [item.resource.id, item.availability]));
  const repositories = resources.filter(
    (resource) => resource.kind === 'repository' && ids.includes(resource.id),
  );
  const dirty = statuses.filter((status) => status.change_count > 0 && ids.includes(status.resource_id));
  const invalidBranch = branchNameIssue(draft.branch || '');
  const conflictingName =
    draft.branch &&
    statuses.some((status) => ids.includes(status.resource_id) && status.branches.includes(draft.branch!));
  const issue =
    invalidBranch || (conflictingName ? 'That branch already exists. Choose a new task branch name.' : '');
  useEffect(() => {
    if (!repositories.length)
      setDraft((current) => ({ ...current, branch: null, include_local_changes: false }));
  }, [repositories.length]);
  const apply = () => {
    const bases: Record<string, string> = {};
    for (const resource of repositories) {
      const branch =
        draft.base_branches[resource.id] ||
        (resource.kind === 'repository' ? resource.default_branch : null) ||
        byId.get(resource.id)?.branch;
      if (branch) bases[resource.id] = branch;
    }
    onApply(ids, { ...draft, base_branches: bases });
  };
  return (
    <Modal
      open
      onClose={onClose}
      placement="left"
      leftOffset={leftOffset}
      width="min(460px, calc(100vw - 16px))"
      height="calc(100dvh - 16px)"
      labelledBy={titleId}
    >
      <div className="code-repository-drawer__header">
        <span className="code-eyebrow">NEW TASK</span>
        <ModalHeader id={titleId} title="Repositories & folders" onClose={onClose} />
      </div>
      <ModalBody padding="24px" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!local && (
          <Alert>
            Choose this computer to set task branches and include local changes. Resource selection works on
            any computer.
          </Alert>
        )}
        {local && (
          <div className="code-repository-branch-field">
            <label htmlFor={branchId}>
              New branch for this task <span>Optional</span>
            </label>
            <Input
              id={branchId}
              leading={<GitBranch size={15} />}
              placeholder="feat/repo-status"
              value={draft.branch || ''}
              onChange={(value) => setDraft({ ...draft, branch: value || null })}
              disabled={!repositories.length}
              aria-invalid={!!issue}
              aria-describedby={`${branchId}-hint`}
            />
            <small id={`${branchId}-hint`} className={issue ? 'is-error' : ''}>
              {issue || 'Created in each selected repository. Leave blank for an automatic name.'}
            </small>
          </div>
        )}
        <section className="code-repository-list" aria-label="Include in this task">
          <div className="code-repository-list__labels">
            <span>INCLUDE IN THIS TASK</span>
            <span>{local ? 'START FROM' : ''}</span>
          </div>
          {resources.map((resource) => {
            const checked = ids.includes(resource.id);
            const state = byId.get(resource.id);
            const access = availability.get(resource.id);
            const computer = computers.find((item) => item.id === access?.required_computer_id);
            const location =
              access?.status === 'offline'
                ? `${computer?.name || 'Required computer'} is offline`
                : access?.required_computer_id && !computer?.is_local
                  ? `Only on ${computer?.name || 'its linked computer'}`
                  : access?.status === 'unavailable'
                    ? access.detail
                    : '';
            const base =
              draft.base_branches[resource.id] ||
              (resource.kind === 'repository' ? resource.default_branch : null) ||
              state?.branch ||
              '';
            const branches = [...new Set([...(base ? [base] : []), ...(state?.branches || [])])];
            return (
              <div className="code-repository-row" key={resource.id}>
                <label>
                  <Checkbox
                    size="sm"
                    checked={checked}
                    aria-label={`Include ${resource.name}`}
                    disabled={checked && ids.length === 1}
                    onCheckedChange={() =>
                      setIds(checked ? ids.filter((id) => id !== resource.id) : [...ids, resource.id])
                    }
                  />
                  <span>
                    <strong>
                      {resource.kind === 'local_folder' && <Folder size={14} />} {resource.name}
                    </strong>
                    <small>
                      {location ||
                        (resource.kind === 'local_folder'
                          ? 'Local folder · copied into this task'
                          : !local
                            ? 'On the selected computer'
                            : state?.detail ||
                              (state?.local
                                ? `On this computer: ${state.branch || 'detached HEAD'}${state.change_count ? '' : ' · clean'}`
                                : loading ? 'Checking repository…' : 'Status unavailable'))}
                    </small>
                  </span>
                </label>
                {local && resource.kind === 'repository' && (
                  <RepositoryBranchSelect
                    projectId={projectId}
                    resourceId={resource.id}
                    name={resource.name}
                    value={base}
                    branches={branches}
                    local={state?.local === true}
                    disabled={!checked || loading || !!error}
                    onChange={(value) =>
                      setDraft({ ...draft, base_branches: { ...draft.base_branches, [resource.id]: value } })
                    }
                  />
                )}
              </div>
            );
          })}
        </section>
        {local && (
          <>
            <div className="code-repository-refresh">
              <span aria-live="polite">
                {loading ? (
                  <>
                    <Spinner /> Checking repositories…
                  </>
                ) : (
                  'Local checkout status'
                )}
              </span>
              <Button size="sm" variant="subtle" disabled={loading} onClick={onRefresh}>
                <RefreshCw size={13} />
                Refresh
              </Button>
            </div>
            {error && <Alert variant="danger">{error}</Alert>}
            {dirty.map((status) => (
              <RepositoryLocalChanges
                key={`${status.resource_id}:${statusRevision}`}
                projectId={projectId}
                name={resources.find((resource) => resource.id === status.resource_id)!.name}
                status={status}
              />
            ))}
            {repositories.length > 0 && (
              <fieldset className="code-repository-policy">
                <legend>Local changes</legend>
                <label className={!draft.include_local_changes ? 'is-selected' : ''}>
                  <input
                    type="radio"
                    name="repository-changes"
                    checked={!draft.include_local_changes}
                    onChange={() => setDraft({ ...draft, include_local_changes: false })}
                  />
                  <span>
                    <strong>Start from committed code</strong>
                    <small>Leave local changes on this computer.</small>
                  </span>
                </label>
                <label className={draft.include_local_changes ? 'is-selected' : ''}>
                  <input
                    type="radio"
                    name="repository-changes"
                    checked={draft.include_local_changes}
                    onChange={() => setDraft({ ...draft, include_local_changes: true })}
                  />
                  <span>
                    <strong>Include my local changes</strong>
                    <small>Copy them into this task. Keep originals.</small>
                  </span>
                </label>
              </fieldset>
            )}
          </>
        )}
        <p className="code-repository-safety">
          <ShieldCheck size={16} />
          <span>These choices apply to this task. Your original checkouts and folders stay unchanged.</span>
        </p>
      </ModalBody>
      <ModalFooter align="space-between">
        <span className="code-repository-count">
          {repositories.length} {repositories.length === 1 ? 'repository' : 'repositories'} ·{' '}
          {ids.length - repositories.length} {ids.length - repositories.length === 1 ? 'folder' : 'folders'}
        </span>
        <Button
          variant="primary"
          disabled={!ids.length || !!issue || (local && (loading || !!error))}
          onClick={apply}
        >
          Apply to task
        </Button>
      </ModalFooter>
    </Modal>
  );
}
