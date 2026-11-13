import { useEffect, useMemo, useState } from 'react';

import { host } from '../../platform/host';
import { useTranslation } from '../../lib/i18n';
import { ConfirmModal } from '../components/ConfirmModal';
import Ico from '../components/Icons';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Checkbox from '../components/ui/Checkbox';
import Input from '../components/ui/Input';
import OverflowMenu from '../components/OverflowMenu';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import {
  CollectionState,
  FilterChips,
  FilterMenu,
  FilterRow,
  ItemActions,
  ListGroup,
  ListItem,
  ListNotice,
  PageHeader,
  SearchInput,
  type Filter,
} from '../components/collection';
import {
  codingApi,
  type CodeProject,
  type SkillLibraryItem,
  type SkillLibrarySource,
} from './api';
import { SkillDetailModal } from './SkillDetailModal';
import { PersonalSkillModal } from './PersonalSkillModal';
import { personalSkillsApi } from './personalSkillsApi';
import { openCodeRepository } from './shellLinks';
import { useSkillLibrary } from './useSkillLibrary';
import './code-skills.css';

type OriginFilter = 'all' | SkillLibraryItem['origin'];

type T = (key: string, values?: Record<string, unknown>) => string;

function originOptions(t: T) {
  return [
    { value: 'all', label: t('skills.origin.all') },
    { value: 'team', label: t('skills.origin.team') },
    { value: 'personal', label: t('skills.origin.personal') },
    { value: 'built_in', label: 'MindsHub' },
  ];
}

function kindLabel(kind: SkillLibraryItem['kind'], t: T): string {
  if (kind === 'instructions') return t('skills.kind.instructions');
  if (kind === 'workflow') return t('skills.kind.workflow');
  return t('skills.kind.skill');
}

function shortRevision(value: string | null | undefined, t: T): string {
  return value?.slice(0, 8) || t('skills.unversioned');
}

function AddSkillSourceModal({
  open,
  busy,
  onClose,
  onAdd,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onAdd: (values: { name?: string; repository: string; branch: string }) => Promise<void>;
}) {
  const { t } = useTranslation('code');
  const [name, setName] = useState('');
  const [repository, setRepository] = useState('');
  const [branch, setBranch] = useState('main');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setRepository('');
    setBranch('main');
    setError('');
  }, [open]);

  const submit = async () => {
    if (!repository.trim()) { setError(t('skills.addSource.repositoryRequired')); return; }
    setError('');
    try {
      await onAdd({ name: name.trim() || undefined, repository: repository.trim(), branch: branch.trim() || 'main' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('skills.addSource.addFailed'));
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="add-skill-source-title" dismissible={!busy}>
      <ModalHeader
        id="add-skill-source-title"
        title={t('skills.addSource.title')}
        subtitle={t('skills.addSource.subtitle')}
        onClose={onClose}
      />
      <ModalBody>
        <div className="code-skill-source-form">
          <label><span>{t('skills.addSource.repositoryLabel')}</span><div><Input value={repository} onChange={setRepository} placeholder="https://github.com/acme/engineering-skills" autoFocus /><Button variant="subtle" onClick={async () => {
            const result = await host.pickCodeFolder();
            if (result.ok && result.path) { setRepository(result.path); setError(''); }
            else if (!result.cancelled) setError(result.reason || t('skills.addSource.folderFailed'));
          }}>{Ico.folder(14)} {t('skills.addSource.choose')}</Button></div></label>
          <div className="code-skill-source-form__pair">
            <label><span>{t('skills.addSource.nameLabel')} <small>{t('skills.addSource.optional')}</small></span><Input value={name} onChange={setName} placeholder={t('skills.addSource.namePlaceholder')} /></label>
            <label><span>{t('skills.addSource.branchLabel')}</span><Input value={branch} onChange={setBranch} placeholder="main" /></label>
          </div>
          {error && <Alert variant="danger">{error}</Alert>}
        </div>
      </ModalBody>
      <ModalFooter cancel={<Button variant="subtle" onClick={onClose} disabled={busy}>{t('skills.cancel')}</Button>}>
        <Button variant="primary" onClick={() => void submit()} disabled={busy || !repository.trim()}>{busy ? t('skills.addSource.adding') : t('skills.addSource.add')}</Button>
      </ModalFooter>
    </Modal>
  );
}

function SkillProjectsModal({
  item,
  projects,
  open,
  busy,
  error,
  onClose,
  onSave,
}: {
  item: SkillLibraryItem | null;
  projects: CodeProject[];
  open: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (projectIds: string[]) => Promise<void>;
}) {
  const { t } = useTranslation('code');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected(new Set(item?.enabled_project_ids || []));
  }, [item]);
  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="skill-projects-title" dismissible={!busy}>
      <ModalHeader
        id="skill-projects-title"
        title={item?.name || t('skills.projects.title')}
        subtitle={t('skills.projects.subtitle')}
        onClose={onClose}
      />
      <ModalBody padding="0">
        <div className="code-skill-project-list">
          {projects.map((project) => (
            <label key={project.id}>
              <Checkbox size="sm" aria-label={project.name} checked={selected.has(project.id)} onCheckedChange={(checked) => setSelected((current) => {
                const next = new Set(current);
                if (checked) next.add(project.id); else next.delete(project.id);
                return next;
              })} />
              <span className="code-skill-project-list__copy"><strong>{project.name}</strong><small>{t('skills.projects.folders', { count: project.folders.length })}</small></span>
            </label>
          ))}
          {!projects.length && <div className="code-skill-project-list__empty">{t('skills.projects.empty')}</div>}
        </div>
        {error && <div className="code-skill-modal-error"><Alert variant="danger">{error}</Alert></div>}
      </ModalBody>
      <ModalFooter cancel={<Button variant="subtle" onClick={onClose} disabled={busy}>{t('skills.cancel')}</Button>}>
        <Button variant="primary" onClick={() => void onSave([...selected])} disabled={busy || !projects.length}>{busy ? t('skills.saving') : t('skills.save')}</Button>
      </ModalFooter>
    </Modal>
  );
}

function SkillSourceModal({
  source,
  open,
  busy,
  actionError,
  onClose,
  onRefresh,
  onApply,
  onOpenRepository,
}: {
  source: SkillLibrarySource | null;
  open: boolean;
  busy: boolean;
  actionError: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onApply: () => Promise<void>;
  onOpenRepository: () => Promise<void>;
}) {
  const { t } = useTranslation('code');
  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="skill-source-title" dismissible={!busy}>
      <ModalHeader id="skill-source-title" title={source?.name || t('skills.source.fallbackTitle')} subtitle={source ? `${source.branch} · ${shortRevision(source.current_revision, t)}` : ''} onClose={onClose} />
      <ModalBody>
        {source && <div className="code-skill-source-detail">
          <div><span>{t('skills.source.repository')}</span><code>{source.repository}</code></div>
          <div className="code-skill-source-detail__stats">
            <span><strong>{source.item_count}</strong> {t('skills.source.itemsUnit', { count: source.item_count })}</span>
            <span><strong>{source.enabled_project_count}</strong> {t('skills.source.projectsUnit', { count: source.enabled_project_count })}</span>
          </div>
          {source.enabled_project_count > 0 && <span className="code-skill-source-usage">
            {Ico.folder(14)} {t('skills.usedBy', { count: source.enabled_project_count })}
          </span>}
          {(actionError || source.error) && <Alert variant="danger">{actionError || source.error}</Alert>}
          {source.update_available && <div className="code-skill-source-update">
            <strong>{t('skills.updateAvailable')}</strong>
            <span>{shortRevision(source.current_revision, t)} → {shortRevision(source.available_revision, t)}</span>
            {source.diff && <pre>{source.diff}</pre>}
          </div>}
        </div>}
      </ModalBody>
      <ModalFooter cancel={<Button variant="subtle" onClick={onClose} disabled={busy}>{t('skills.close')}</Button>}>
        <Button variant="subtle" onClick={() => void onOpenRepository()} disabled={busy}>{t('skills.source.openRepository')}</Button>
        <Button variant="subtle" onClick={() => void onRefresh()} disabled={busy}>{Ico.refresh(14)} {t('skills.source.checkUpdates')}</Button>
        {source?.update_available && <Button variant="primary" onClick={() => void onApply()} disabled={busy}>{t('skills.source.update')}</Button>}
      </ModalFooter>
    </Modal>
  );
}

export function CodeSkillsView({ projects }: { projects: CodeProject[] }) {
  const { t } = useTranslation('code');
  const { page: library, loading, error, reload: load } = useSkillLibrary();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<OriginFilter>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [projectItem, setProjectItem] = useState<SkillLibraryItem | null>(null);
  const [projectError, setProjectError] = useState('');
  const [sourceDetail, setSourceDetail] = useState<SkillLibrarySource | null>(null);
  const [sourceActionError, setSourceActionError] = useState('');
  const [removePending, setRemovePending] = useState<SkillLibrarySource | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [detailItem, setDetailItem] = useState<SkillLibraryItem | null>(null);
  const [personalEditor, setPersonalEditor] = useState<{ id?: string } | null>(null);
  const [deletePending, setDeletePending] = useState<SkillLibraryItem | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return library.items.filter((item) => (
      (filter === 'all' || item.origin === filter)
      && (!normalized || `${item.name} ${item.description} ${item.source_name} ${item.path}`.toLowerCase().includes(normalized))
    ));
  }, [filter, library.items, query]);

  const teamBySource = useMemo(() => new Map(library.sources.map((source) => [
    source.id,
    visibleItems.filter((item) => item.origin === 'team' && item.source_id === source.id),
  ])), [library.sources, visibleItems]);
  const personal = visibleItems.filter((item) => item.origin === 'personal');
  const builtIn = visibleItems.filter((item) => item.origin === 'built_in');
  const hasVisibleTeamSource = (filter === 'all' || filter === 'team') && library.sources.some((source) => (
    !query.trim() || (teamBySource.get(source.id)?.length || 0) > 0
  ));
  const hasVisibleCatalog = visibleItems.length > 0 || hasVisibleTeamSource;

  const saveProjects = async (selectedProjectIds: string[]) => {
    if (!projectItem?.source_id) return;
    setBusy(true); setProjectError('');
    try {
      const before = new Set(projectItem.enabled_project_ids);
      const after = new Set(selectedProjectIds);
      const changed = projects.filter((project) => before.has(project.id) !== after.has(project.id));
      const assignments = changed.map((project) => {
        const paths = library.items
          .filter((item) => item.source_id === projectItem.source_id && item.enabled_project_ids.includes(project.id))
          .map((item) => item.path);
        const next = new Set(paths);
        if (after.has(project.id)) next.add(projectItem.path); else next.delete(projectItem.path);
        return { project_id: project.id, enabled_paths: [...next] };
      });
      if (assignments.length) {
        await codingApi.setSkillSourceProjects(projectItem.source_id, assignments);
      }
      await load();
      setProjectItem(null);
    } catch (reason) {
      setProjectError(reason instanceof Error ? reason.message : t('skills.errors.updateProjects'));
    } finally { setBusy(false); }
  };

  const updateSource = async (operation: 'refresh' | 'apply') => {
    if (!sourceDetail) return;
    setBusy(true); setSourceActionError('');
    try {
      const updated = operation === 'refresh'
        ? await codingApi.refreshSkillSource(sourceDetail.id)
        : await codingApi.applySkillSource(sourceDetail.id);
      setSourceDetail(updated);
      await load();
    } catch (reason) { setSourceActionError(reason instanceof Error ? reason.message : t('skills.errors.updateSource')); }
    finally { setBusy(false); }
  };

  const openSource = (source: SkillLibrarySource) => { setSourceActionError(''); setSourceDetail(source); };
  const groupTitle = (label: string) => <h2>{label}</h2>;
  const rows = (items: SkillLibraryItem[]) => items.map((item) => (
    <ListItem
      key={item.id}
      leading={<span className="inline-flex size-6 items-center justify-center rounded-md bg-surface-2 text-ink-3">
        {item.kind === 'skill' ? Ico.cube(14) : Ico.code(14)}
      </span>}
      title={item.name}
      description={item.description || item.path}
      onActivate={() => setDetailItem(item)}
      activateLabel={t('skills.view.viewItem', { name: item.name })}
      meta={<>
        <span className="max-sm:hidden">{kindLabel(item.kind, t)}</span>
        {item.origin === 'team' ? (
          <ItemActions>
            <Button size="sm" variant="subtle" onClick={() => setProjectItem(item)}>
              {item.enabled_project_ids.length ? t('skills.view.projectCount', { count: item.enabled_project_ids.length }) : t('skills.projects.title')}
            </Button>
          </ItemActions>
        ) : <span>{item.enabled ? t('skills.view.available') : t('skills.view.disabled')}</span>}
      </>}
      // Delete is its own flow beside Edit, not a button inside the editor.
      actions={item.origin === 'personal'
        ? <OverflowMenu
            label={t('skills.view.moreActions', { name: item.name })}
            icon={Ico.more(14)}
            size="sm"
            items={[
              { id: 'edit', label: t('skills.view.edit'), icon: Ico.edit(14), onClick: () => setPersonalEditor({ id: item.path }) },
              { id: 'delete', label: t('skills.view.delete'), icon: Ico.trash(14), danger: true, onClick: () => { setDeleteError(''); setDeletePending(item); } },
            ]}
          />
        : undefined}
    />
  ));
  const showTeam = filter === 'all' || filter === 'team';
  const searching = Boolean(query.trim());

  const filters: Filter[] = [{
    id: 'source', label: t('skills.view.sourceFilter'), value: filter, allValue: 'all', options: originOptions(t),
    onChange: (value) => setFilter(value as OriginFilter),
  }];

  return (
    <main className="code-skills-view titlebar-fade titlebar-fade--page">
      <PageHeader
        title={t('skills.view.title')}
        subtitle={t('skills.view.subtitle')}
        actions={<div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="subtle" onClick={() => setAddOpen(true)}>{Ico.link(14)} {t('skills.addSource.title')}</Button>
          <Button variant="primary" onClick={() => setPersonalEditor({})}>{Ico.plus(14)} {t('skills.view.addPersonal')}</Button>
        </div>}
      />
      <FilterRow
        search={<SearchInput value={query} onChange={setQuery} placeholder={t('skills.view.searchPlaceholder')} shortcut="" />}
        filter={<FilterMenu filters={filters} />}
        chips={<FilterChips filters={filters} onClear={() => setFilter('all')} />}
      />

      {error && <div className="mx-8 mb-4"><Alert variant="danger">{error}</Alert></div>}
      <div className="mx-8 grid gap-6">
        <CollectionState
          loading={loading}
          skeleton="rows"
          skeletonCount={4}
          // The origin pill narrows what exists, so an empty pill reads as
          // "nothing here yet"; only a search with no hits is a no-match.
          total={hasVisibleCatalog || searching ? 1 : 0}
          shown={hasVisibleCatalog ? 1 : 0}
          onClear={() => setQuery('')}
          noMatchTitle={t('skills.view.noMatch')}
          empty={filter === 'personal' || filter === 'all'
            ? {
                icon: Ico.cube(20),
                title: t('skills.view.emptyPersonal.title'),
                description: t('skills.view.emptyPersonal.description'),
                action: { label: t('skills.view.emptyPersonal.action'), onClick: () => setPersonalEditor({}) },
              }
            : filter === 'team'
              ? { icon: Ico.link(20), title: t('skills.view.emptyTeam.title'), description: t('skills.view.emptyTeam.description') }
              : { title: t('skills.view.emptyView') }}
        >
          {showTeam && library.sources.map((source) => {
            const items = teamBySource.get(source.id) || [];
            if (!items.length && searching) return null;
            return <ListGroup
              key={source.id}
              title={<button
                type="button"
                className="group/src flex min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left font-body text-ink"
                onClick={() => openSource(source)}
              >
                <span className="inline-flex text-ink-4">{Ico.link(14)}</span>
                <strong className="group-hover/src:text-accent">{source.name}</strong>
                <small className="truncate font-mono text-xs font-normal text-ink-4">{source.branch} · {shortRevision(source.current_revision, t)}</small>
              </button>}
              meta={source.error || source.update_available ? undefined : t('skills.view.itemCount', { count: source.item_count })}
              actions={<>
                {source.error ? <Button size="sm" variant="tinted" onClick={() => openSource(source)}>{t('skills.view.needsAttention')}</Button>
                  : source.update_available ? <Button size="sm" variant="tinted" onClick={() => openSource(source)}>{t('skills.updateAvailable')}</Button>
                    : null}
                <OverflowMenu
                  label={t('skills.view.moreActions', { name: source.name })}
                  icon={Ico.more(14)}
                  size="sm"
                  items={[
                    { id: 'details', label: t('skills.view.sourceDetails'), icon: Ico.settings(14), onClick: () => openSource(source) },
                    // A source in use can't be removed; say why instead of hiding it.
                    { id: 'remove', label: t('skills.source.remove'), icon: Ico.trash(14), danger: true,
                      disabled: source.enabled_project_count > 0,
                      hint: source.enabled_project_count > 0 ? t('skills.usedBy', { count: source.enabled_project_count }) : undefined,
                      onClick: () => { setRemoveError(''); setRemovePending(source); } },
                  ]}
                />
              </>}
            >
              {items.length ? rows(items) : <ListNotice className="py-6 text-center text-xs text-ink-4">
                {source.error ? t('skills.view.sourceUnavailable') : searching ? t('skills.view.noItemsMatch') : t('skills.view.noSharedItems')}
              </ListNotice>}
            </ListGroup>;
          })}
          {(filter === 'all' || filter === 'personal') && personal.length > 0 && (
            <ListGroup title={groupTitle(t('skills.origin.personal'))} description={t('skills.view.personalDescription')} meta={personal.length}>{rows(personal)}</ListGroup>
          )}
          {(filter === 'all' || filter === 'built_in') && builtIn.length > 0 && (
            <ListGroup title={groupTitle('MindsHub')} description={t('skills.view.builtInDescription')} meta={builtIn.length}>{rows(builtIn)}</ListGroup>
          )}
        </CollectionState>
      </div>

      <AddSkillSourceModal open={addOpen} busy={busy} onClose={() => setAddOpen(false)} onAdd={async (values) => {
        setBusy(true);
        try { await codingApi.addSkillSource(values); await load(); setAddOpen(false); }
        finally { setBusy(false); }
      }} />
      <SkillProjectsModal item={projectItem} projects={projects} open={!!projectItem} busy={busy} error={projectError} onClose={() => { setProjectItem(null); setProjectError(''); }} onSave={saveProjects} />
      <SkillSourceModal
        source={sourceDetail}
        open={!!sourceDetail}
        busy={busy}
        actionError={sourceActionError}
        onClose={() => { setSourceDetail(null); setSourceActionError(''); }}
        onRefresh={() => updateSource('refresh')}
        onApply={() => updateSource('apply')}
        onOpenRepository={async () => {
          if (!sourceDetail) return;
          setSourceActionError('');
          try { await openCodeRepository(sourceDetail.repository); }
          catch (reason) { setSourceActionError(reason instanceof Error ? reason.message : t('skills.errors.openRepository')); }
        }}
      />
      <ConfirmModal
        open={!!removePending}
        title={t('skills.removeConfirm.title')}
        message={removeError || (removePending ? t('skills.removeConfirm.message', { name: removePending.name }) : '')}
        confirmLabel={t('skills.source.remove')}
        destructive
        busy={busy}
        busyLabel={t('skills.removeConfirm.busy')}
        onClose={() => { setRemovePending(null); setRemoveError(''); }}
        onConfirm={async () => {
          if (!removePending) return;
          setBusy(true);
          try {
            await codingApi.removeSkillSource(removePending.id);
            setRemovePending(null);
            setSourceDetail(null);
            await load();
          } catch (reason) {
            setRemoveError(reason instanceof Error ? reason.message : t('skills.errors.removeSource'));
          } finally { setBusy(false); }
        }}
      />
      <ConfirmModal
        open={!!deletePending}
        title={t('skills.deleteConfirm.title')}
        message={deletePending ? t('skills.deleteConfirm.message', { name: deletePending.name }) : ''}
        confirmLabel={t('skills.deleteConfirm.confirm')}
        destructive
        busy={busy}
        busyLabel={t('skills.deleteConfirm.busy')}
        error={deleteError}
        onClose={() => { setDeletePending(null); setDeleteError(''); }}
        onConfirm={async () => {
          if (!deletePending) return;
          setBusy(true); setDeleteError('');
          try {
            await personalSkillsApi.remove(deletePending.path);
            setDeletePending(null);
            await load();
          } catch (reason) {
            setDeleteError(reason instanceof Error ? reason.message : t('skills.errors.deleteSkill'));
          } finally { setBusy(false); }
        }}
      />
      <SkillDetailModal item={detailItem} onClose={() => setDetailItem(null)} />
      {personalEditor && <PersonalSkillModal skillId={personalEditor.id} onClose={() => setPersonalEditor(null)} onSaved={() => {
        setPersonalEditor(null); setFilter('personal'); setQuery(''); void load();
      }} />}
    </main>
  );
}
