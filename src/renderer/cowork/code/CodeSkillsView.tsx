import { useEffect, useMemo, useState } from 'react';

import { host } from '../../platform/host';
import { ConfirmModal } from '../components/ConfirmModal';
import Ico from '../components/Icons';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Checkbox from '../components/ui/Checkbox';
import Input from '../components/ui/Input';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import Select from '../components/ui/Select';
import {
  CollectionState,
  FilterRow,
  HoverActions,
  ListGroup,
  ListItem,
  ListNotice,
  PageHeader,
  SearchInput,
} from '../components/collection';
import {
  codingApi,
  type CodeProject,
  type SkillLibraryItem,
  type SkillLibrarySource,
} from './api';
import { SkillDetailModal } from './SkillDetailModal';
import { PersonalSkillModal } from './PersonalSkillModal';
import { openCodeRepository } from './shellLinks';
import { useSkillLibrary } from './useSkillLibrary';
import './code-skills.css';

type OriginFilter = 'all' | SkillLibraryItem['origin'];

const ORIGIN_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'team', label: 'Team' },
  { value: 'personal', label: 'Yours' },
  { value: 'built_in', label: 'MindsHub' },
];

function kindLabel(kind: SkillLibraryItem['kind']): string {
  if (kind === 'instructions') return 'Instructions';
  if (kind === 'workflow') return 'Workflow';
  return 'Skill';
}

function shortRevision(value: string | null | undefined): string {
  return value?.slice(0, 8) || 'Unversioned';
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
    if (!repository.trim()) { setError('Choose a Git repository or enter its URL.'); return; }
    setError('');
    try {
      await onAdd({ name: name.trim() || undefined, repository: repository.trim(), branch: branch.trim() || 'main' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add that team source.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="add-skill-source-title" closeOnBackdrop={!busy} closeOnEsc={!busy}>
      <ModalHeader
        id="add-skill-source-title"
        title="Add team source"
        subtitle="Connect a Git repository containing skills, instructions, or workflows."
        onClose={onClose}
      />
      <ModalBody>
        <div className="code-skill-source-form">
          <label><span>Repository or folder</span><div><Input value={repository} onChange={setRepository} placeholder="https://github.com/acme/engineering-skills" autoFocus /><Button variant="subtle" onClick={async () => {
            const result = await host.pickCodeFolder();
            if (result.ok && result.path) { setRepository(result.path); setError(''); }
            else if (!result.cancelled) setError(result.reason || 'Could not choose that folder.');
          }}>{Ico.folder(13)} Choose</Button></div></label>
          <div className="code-skill-source-form__pair">
            <label><span>Name <small>Optional</small></span><Input value={name} onChange={setName} placeholder="Engineering standards" /></label>
            <label><span>Branch</span><Input value={branch} onChange={setBranch} placeholder="main" /></label>
          </div>
          {error && <Alert variant="danger">{error}</Alert>}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={busy || !repository.trim()}>{busy ? 'Adding…' : 'Add source'}</Button>
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected(new Set(item?.enabled_project_ids || []));
  }, [item]);
  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="skill-projects-title" closeOnBackdrop={!busy} closeOnEsc={!busy}>
      <ModalHeader
        id="skill-projects-title"
        title={item?.name || 'Choose projects'}
        subtitle="Make this available to tasks in the selected Code Projects."
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
              <span className="code-skill-project-list__copy"><strong>{project.name}</strong><small>{project.folders.length} folder{project.folders.length === 1 ? '' : 's'}</small></span>
            </label>
          ))}
          {!projects.length && <div className="code-skill-project-list__empty">Create a Code Project before assigning team skills.</div>}
        </div>
        {error && <div className="code-skill-modal-error"><Alert variant="danger">{error}</Alert></div>}
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => void onSave([...selected])} disabled={busy || !projects.length}>{busy ? 'Saving…' : 'Save'}</Button>
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
  onRemove,
  onOpenRepository,
}: {
  source: SkillLibrarySource | null;
  open: boolean;
  busy: boolean;
  actionError: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onApply: () => Promise<void>;
  onRemove: () => Promise<void>;
  onOpenRepository: () => Promise<void>;
}) {
  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="skill-source-title" closeOnBackdrop={!busy} closeOnEsc={!busy}>
      <ModalHeader id="skill-source-title" title={source?.name || 'Team source'} subtitle={source ? `${source.branch} · ${shortRevision(source.current_revision)}` : ''} onClose={onClose} />
      <ModalBody>
        {source && <div className="code-skill-source-detail">
          <div><span>Repository</span><code>{source.repository}</code></div>
          <div className="code-skill-source-detail__stats">
            <span><strong>{source.item_count}</strong> items</span>
            <span><strong>{source.enabled_project_count}</strong> project{source.enabled_project_count === 1 ? '' : 's'}</span>
          </div>
          {(actionError || source.error) && <Alert variant="danger">{actionError || source.error}</Alert>}
          {source.update_available && <div className="code-skill-source-update">
            <strong>Update available</strong>
            <span>{shortRevision(source.current_revision)} → {shortRevision(source.available_revision)}</span>
            {source.diff && <pre>{source.diff}</pre>}
          </div>}
        </div>}
      </ModalBody>
      <ModalFooter>
        {source?.enabled_project_count ? (
          <span className="code-skill-source-usage">
            {Ico.folder(13)} Used by {source.enabled_project_count} project{source.enabled_project_count === 1 ? '' : 's'}
          </span>
        ) : <Button variant="danger" onClick={() => void onRemove()} disabled={busy}>Remove source</Button>}
        <span className="flex-1" />
        <Button variant="subtle" onClick={() => void onOpenRepository()} disabled={busy}>Open repository</Button>
        <Button variant="subtle" onClick={() => void onRefresh()} disabled={busy}>{Ico.refresh(13)} Check for updates</Button>
        {source?.update_available && <Button variant="primary" onClick={() => void onApply()} disabled={busy}>Update source</Button>}
      </ModalFooter>
    </Modal>
  );
}

export function CodeSkillsView({ projects }: { projects: CodeProject[] }) {
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
      setProjectError(reason instanceof Error ? reason.message : 'Could not update project skills.');
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
    } catch (reason) { setSourceActionError(reason instanceof Error ? reason.message : 'Could not update that source.'); }
    finally { setBusy(false); }
  };

  const openSource = (source: SkillLibrarySource) => { setSourceActionError(''); setSourceDetail(source); };
  const groupTitle = (label: string) => <h2 className="m-0 text-xs font-semibold text-ink">{label}</h2>;
  const rows = (items: SkillLibraryItem[]) => items.map((item) => (
    <ListItem
      key={item.id}
      leading={<span className="inline-flex size-6 items-center justify-center rounded-md bg-surface-2 text-ink-3">
        {item.kind === 'skill' ? Ico.cube(14) : Ico.code(14)}
      </span>}
      title={item.name}
      description={item.description || item.path}
      onActivate={() => setDetailItem(item)}
      activateLabel={`View ${item.name}`}
      meta={<>
        <span className="max-sm:hidden">{kindLabel(item.kind)}</span>
        {item.origin === 'team' ? (
          <HoverActions reveal>
            <Button size="sm" variant="subtle" onClick={() => setProjectItem(item)}>
              {item.enabled_project_ids.length ? `${item.enabled_project_ids.length} project${item.enabled_project_ids.length === 1 ? '' : 's'}` : 'Choose projects'}
            </Button>
          </HoverActions>
        ) : <span>{item.enabled ? 'Available' : 'Disabled'}</span>}
      </>}
      actions={item.origin === 'personal'
        ? <Button size="sm" variant="subtle" aria-label={`Edit ${item.name}`} onClick={() => setPersonalEditor({ id: item.path })}>Edit</Button>
        : undefined}
    />
  ));
  const showTeam = filter === 'all' || filter === 'team';
  const searching = Boolean(query.trim());

  return (
    <main className="code-skills-view">
      <PageHeader
        title="Skills"
        subtitle="Your workflows and your team’s engineering standards, ready for Code tasks."
        actions={<div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="subtle" onClick={() => setAddOpen(true)}>{Ico.link(13)} Add team source</Button>
          <Button variant="primary" onClick={() => setPersonalEditor({})}>{Ico.plus(13)} Add personal skill</Button>
        </div>}
      />
      <FilterRow
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search skills" shortcut="" />}
        sort={<Select
          variant="pill"
          label="Source"
          value={filter}
          onValueChange={(value: string) => setFilter(value as OriginFilter)}
          options={ORIGIN_OPTIONS}
          menuMinWidth={160}
        />}
      />

      {error && <div className="mx-8 mt-5"><Alert variant="danger">{error}</Alert></div>}
      <div className="mx-8 mt-5 grid gap-6">
        <CollectionState
          loading={loading}
          skeleton="rows"
          skeletonCount={4}
          // The origin pill narrows what exists, so an empty pill reads as
          // "nothing here yet"; only a search with no hits is a no-match.
          total={hasVisibleCatalog || searching ? 1 : 0}
          shown={hasVisibleCatalog ? 1 : 0}
          onClear={() => setQuery('')}
          noMatchTitle="No skills match your search."
          empty={filter === 'personal' || filter === 'all'
            ? {
                icon: Ico.cube(20),
                title: 'No personal skills yet',
                description: 'Write instructions or import a SKILL.md. No Git repository needed.',
                action: <Button variant="subtle" onClick={() => setPersonalEditor({})}>Add your first skill</Button>,
              }
            : filter === 'team'
              ? { title: 'No team sources yet', description: 'Connect a Git repository to share engineering standards across projects.' }
              : { title: 'No skills in this view.' }}
        >
          {showTeam && library.sources.map((source) => {
            const items = teamBySource.get(source.id) || [];
            if (!items.length && searching) return null;
            return <ListGroup
              key={source.id}
              density="compact"
              title={<button
                type="button"
                className="group/src flex min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left font-body text-ink"
                onClick={() => openSource(source)}
              >
                <span className="inline-flex text-ink-4">{Ico.link(14)}</span>
                <strong className="text-xs font-semibold group-hover/src:text-accent">{source.name}</strong>
                <small className="truncate font-mono text-2xs text-ink-4">{source.branch} · {shortRevision(source.current_revision)}</small>
              </button>}
              meta={source.error || source.update_available ? undefined : `${source.item_count} item${source.item_count === 1 ? '' : 's'}`}
              actions={source.error ? <Button size="sm" variant="tinted" onClick={() => openSource(source)}>Needs attention</Button>
                : source.update_available ? <Button size="sm" variant="tinted" onClick={() => openSource(source)}>Update available</Button>
                  : undefined}
            >
              {items.length ? rows(items) : <ListNotice className="py-6 text-center text-xs text-ink-4">
                {source.error ? 'Source unavailable — open for details.' : searching ? 'No items match this search.' : 'No shared items found.'}
              </ListNotice>}
            </ListGroup>;
          })}
          {(filter === 'all' || filter === 'personal') && personal.length > 0 && (
            <ListGroup density="compact" title={groupTitle('Yours')} description="Personal skills available in Code Mode" meta={personal.length}>{rows(personal)}</ListGroup>
          )}
          {(filter === 'all' || filter === 'built_in') && builtIn.length > 0 && (
            <ListGroup density="compact" title={groupTitle('MindsHub')} description="Engineering skills maintained by MindsHub" meta={builtIn.length}>{rows(builtIn)}</ListGroup>
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
          catch (reason) { setSourceActionError(reason instanceof Error ? reason.message : 'Could not open that repository.'); }
        }}
        onRemove={async () => { if (sourceDetail) { setRemoveError(''); setRemovePending(sourceDetail); } }}
      />
      <ConfirmModal
        open={!!removePending}
        title="Remove team source?"
        message={removeError || (removePending ? `${removePending.name} will be removed from this Skills Library. Its Git repository will not be changed.` : '')}
        confirmLabel="Remove source"
        destructive
        busy={busy}
        busyLabel="Removing…"
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
            setRemoveError(reason instanceof Error ? reason.message : 'Could not remove that source.');
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
