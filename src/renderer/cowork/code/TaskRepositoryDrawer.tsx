import { useEffect, useId, useRef, useState } from 'react';
import { GitBranch, Folder, RefreshCw } from 'lucide-react';
import { Icon } from '../components/ui/Icon';
import Button from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { RadioGroup, Radio } from '../components/ui/RadioGroup';
import Alert from '../components/ui/Alert';
import { Input } from '../components/ui/Input';
import Spinner from '../components/ui/Spinner';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import { codingApi, type CodeComputer, type ProjectResource, type ProjectResourceState } from './api';
import { RepositoryLocalChanges } from './RepositoryLocalChanges';
import { RepositoryBranchSelect } from './RepositoryBranchSelect';
import { branchNameIssue, type RepositoryStatus, type TaskRepositorySetup } from './repositorySetupModels';
import { useTranslation } from '../../lib/i18n';
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
  const { t } = useTranslation('code');
  const titleId = useId();
  const branchId = useId();
  const [ids, setIds] = useState(selectedIds);
  const [draft, setDraft] = useState(setup);
  const [remoteBranches, setRemoteBranches] = useState<Record<string, string[]>>({});
  const [checkingBranches, setCheckingBranches] = useState(false);
  const [branchCheckError, setBranchCheckError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const byId = new Map(statuses.map((status) => [status.resource_id, status]));
  const availability = new Map(resourceStates.map((item) => [item.resource.id, item.availability]));
  const repositories = resources.filter(
    (resource) => resource.kind === 'repository' && ids.includes(resource.id),
  );
  const dirty = statuses.filter((status) => status.change_count > 0 && ids.includes(status.resource_id));
  const invalidBranch = branchNameIssue(draft.branch || '');
  const conflictingName =
    draft.branch &&
    repositories.some((resource) =>
      [...(byId.get(resource.id)?.branches || []), ...(remoteBranches[resource.id] || [])].includes(draft.branch!),
    );
  const unavailable = statuses.some((status) => ids.includes(status.resource_id) && !status.available);
  const issue =
    invalidBranch || (conflictingName ? t('repositoryDrawer.branchExists') : '');
  useEffect(() => {
    if (!repositories.length)
      setDraft((current) => ({ ...current, branch: null, include_local_changes: false }));
  }, [repositories.length]);
  const apply = async () => {
    if (checkingBranches) return;
    const remoteRepositories = repositories.filter(resource => !byId.get(resource.id)?.local);
    if (local && draft.branch && remoteRepositories.length) {
      setCheckingBranches(true);
      setBranchCheckError('');
      try {
        const loaded = await Promise.all(remoteRepositories.map(async resource =>
          [resource.id, (await codingApi.repositoryBranches(projectId, resource.id)).items] as const,
        ));
        if (!mounted.current) return;
        setRemoteBranches(current => ({ ...current, ...Object.fromEntries(loaded) }));
        if (loaded.some(([, branches]) => branches.includes(draft.branch!))) return;
      } catch (reason) {
        if (mounted.current) setBranchCheckError(
          t('repositoryDrawer.retryApply', {
            message: reason instanceof Error ? reason.message : t('repositoryDrawer.remoteCheckFailed'),
          }),
        );
        return;
      } finally {
        if (mounted.current) setCheckingBranches(false);
      }
    }
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
        <span className="section-label">{t('repositoryDrawer.newTask')}</span>
        <ModalHeader id={titleId} title={t('repositoryDrawer.title')} onClose={onClose} />
      </div>
      <ModalBody padding="24px" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!local && (
          <Alert>{t('repositoryDrawer.remoteNotice')}</Alert>
        )}
        {local && (
          <div className="code-repository-branch-field">
            <label htmlFor={branchId}>
              {t('repositoryDrawer.branchLabel')} <span>{t('repositoryDrawer.optional')}</span>
            </label>
            <Input
              id={branchId}
              leading={<Icon of={GitBranch} size={16} />}
              placeholder="feat/repo-status"
              value={draft.branch || ''}
              onChange={(value) => setDraft({ ...draft, branch: value || null })}
              disabled={!repositories.length || checkingBranches}
              aria-invalid={!!issue}
              aria-describedby={`${branchId}-hint`}
            />
            <small id={`${branchId}-hint`} className={issue ? 'is-error' : ''}>
              {issue || t('repositoryDrawer.branchHint')}
            </small>
            {branchCheckError && <Alert variant="danger">{branchCheckError}</Alert>}
          </div>
        )}
        <section className="code-repository-list" aria-label={t('repositoryDrawer.includeInTask')}>
          <div className="code-repository-list__labels section-label">
            <span>{t('repositoryDrawer.includeInTask')}</span>
            <span>{local ? t('repositoryDrawer.startFrom') : ''}</span>
          </div>
          {resources.map((resource) => {
            const checked = ids.includes(resource.id);
            const state = byId.get(resource.id);
            const access = availability.get(resource.id);
            const computer = computers.find((item) => item.id === access?.required_computer_id);
            const location =
              access?.status === 'offline'
                ? t('repositoryDrawer.computerOffline', { name: computer?.name || t('repositoryDrawer.requiredComputer') })
                : access?.required_computer_id && !computer?.is_local
                  ? t('repositoryDrawer.onlyOn', { name: computer?.name || t('repositoryDrawer.linkedComputer') })
                  : access?.status === 'unavailable'
                    ? access.detail
                    : '';
            const base =
              draft.base_branches[resource.id] ||
              (resource.kind === 'repository' ? resource.default_branch : null) ||
              state?.branch ||
              '';
            const branches = [...new Set([...(base ? [base] : []), ...(state?.branches || []), ...(remoteBranches[resource.id] || [])])];
            return (
              <div className="code-repository-row" key={resource.id}>
                <label>
                  <Checkbox
                    size="sm"
                    checked={checked}
                    aria-label={t('repositoryDrawer.include', { name: resource.name })}
                    disabled={checkingBranches || (checked && ids.length === 1)}
                    onCheckedChange={() =>
                      setIds(checked ? ids.filter((id) => id !== resource.id) : [...ids, resource.id])
                    }
                  />
                  <span>
                    <strong>
                      {resource.kind === 'local_folder' && <Icon of={Folder} size={14} />} {resource.name}
                    </strong>
                    <small>
                      {location ||
                        (resource.kind === 'local_folder'
                          ? t('repositoryDrawer.localFolder')
                          : !local
                            ? t('repositoryDrawer.onSelectedComputer')
                            : state?.detail ||
                              (state?.local
                                ? t(state.change_count ? 'repositoryDrawer.onThisComputer' : 'repositoryDrawer.onThisComputerClean', {
                                  branch: state.branch || 'detached HEAD',
                                })
                                : loading ? t('repositoryDrawer.checkingRepository') : t('repositoryDrawer.statusUnavailable')))}
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
                    disabled={!checked || loading || !!error || checkingBranches}
                    onBranchesLoaded={(branches) =>
                      setRemoteBranches((current) => ({ ...current, [resource.id]: branches }))
                    }
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
                    <Spinner /> {t('repositoryDrawer.checkingRepositories')}
                  </>
                ) : (
                  t('repositoryDrawer.checkoutStatus')
                )}
              </span>
              <Button size="sm" variant="subtle" disabled={loading || checkingBranches} onClick={onRefresh}>
                <Icon of={RefreshCw} size={14} />
                {t('repositoryDrawer.refresh')}
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
                <legend id={`${titleId}-changes`}>{t('repositoryDrawer.localChanges')}</legend>
                <RadioGroup
                  className="code-repository-policy__options"
                  aria-labelledby={`${titleId}-changes`}
                  value={draft.include_local_changes ? 'include' : 'committed'}
                  onValueChange={(next) => setDraft({ ...draft, include_local_changes: next === 'include' })}
                  disabled={checkingBranches}
                >
                  <Radio value="committed" variant="card" size="sm">
                    <span>
                      <strong>{t('repositoryDrawer.committedTitle')}</strong>
                      <small>{t('repositoryDrawer.committedHint')}</small>
                    </span>
                  </Radio>
                  <Radio value="include" variant="card" size="sm">
                    <span>
                      <strong>{t('repositoryDrawer.includeTitle')}</strong>
                      <small>{t('repositoryDrawer.includeHint')}</small>
                    </span>
                  </Radio>
                </RadioGroup>
              </fieldset>
            )}
          </>
        )}
      </ModalBody>
      <ModalFooter align="space-between">
        <span className="code-repository-count">
          {t('repositoryDrawer.count', { repositories: repositories.length, folders: ids.length - repositories.length })}
        </span>
        <Button
          variant="primary"
          disabled={checkingBranches || !ids.length || !!issue || (local && (loading || !!error || unavailable))}
          aria-busy={checkingBranches}
          onClick={apply}
        >
          {checkingBranches ? <><Spinner /> {t('repositoryDrawer.checkingBranches')}</> : t('repositoryDrawer.apply')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
