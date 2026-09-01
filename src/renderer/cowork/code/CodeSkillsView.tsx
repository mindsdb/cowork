import { useEffect, useMemo, useState } from 'react';

import { host } from '../../platform/host';
import { ConfirmModal } from '../components/ConfirmModal';
import Ico from '../components/Icons';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import {
  codingApi,
  type CodeProject,
  type SkillLibraryItem,
  type SkillLibrarySource,
} from './api';
import { SkillDetailModal } from './SkillDetailModal';
import { openCodeRepository } from './shellLinks';
import { useSkillLibrary } from './useSkillLibrary';
import './code-skills.css';

type OriginFilter = 'all' | SkillLibraryItem['origin'];

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
              <input type="checkbox" checked={selected.has(project.id)} onChange={(event) => setSelected((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(project.id); else next.delete(project.id);
                return next;
              })} />
              <span><strong>{project.name}</strong><small>{project.folders.length} folder{project.folders.length === 1 ? '' : 's'}</small></span>
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

  const rows = (items: SkillLibraryItem[]) => items.map((item) => (
    <div className="code-skill-row" key={item.id}>
      <button type="button" className="code-skill-row__open" onClick={() => setDetailItem(item)} aria-label={`View ${item.name}`}>
        <span className="code-skill-row__icon" aria-hidden="true">{item.kind === 'skill' ? Ico.cube(14) : Ico.code(14)}</span>
        <span className="code-skill-row__main"><strong>{item.name}</strong><span>{item.description || item.path}</span></span>
      </button>
      <span className="code-skill-row__kind">{kindLabel(item.kind)}</span>
      {item.origin === 'team' ? (
        <Button size="sm" variant="subtle" onClick={() => setProjectItem(item)}>
          {item.enabled_project_ids.length ? `${item.enabled_project_ids.length} project${item.enabled_project_ids.length === 1 ? '' : 's'}` : 'Choose projects'}
        </Button>
      ) : <span className="code-skill-row__availability">{item.enabled ? 'Available' : 'Disabled'}</span>}
    </div>
  ));

  return (
    <main className="code-skills-view">
      <header className="code-skills-view__header">
        <div><h1>Skills</h1><p>Shared engineering practice, versioned and ready for every coding agent.</p></div>
        <Button variant="primary" onClick={() => setAddOpen(true)}>{Ico.plus(13)} Add team source</Button>
      </header>

      <div className="code-skills-toolbar">
        <label><span aria-hidden="true">{Ico.search(15)}</span><Input value={query} onChange={setQuery} placeholder="Search skills" aria-label="Search skills" /></label>
        <div role="group" aria-label="Filter skills">
          {([['all', 'All'], ['team', 'Team'], ['personal', 'Yours'], ['built_in', 'MindsHub']] as const).map(([value, label]) => (
            <button type="button" key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
      </div>

      {error && <div className="code-skills-view__notice"><Alert variant="danger">{error}</Alert></div>}
      {loading ? <div className="code-skills-empty">Loading skills…</div> : <div className="code-skills-catalog">
        {(filter === 'all' || filter === 'team') && library.sources.map((source) => {
          const items = teamBySource.get(source.id) || [];
          if (!items.length && query.trim()) return null;
          return <section className="code-skill-group" key={source.id}>
            <header>
              <button type="button" onClick={() => { setSourceActionError(''); setSourceDetail(source); }}><span>{Ico.link(14)}</span><strong>{source.name}</strong><small>{source.branch} · {shortRevision(source.current_revision)}</small></button>
              {source.error ? <Button size="sm" variant="tinted" onClick={() => { setSourceActionError(''); setSourceDetail(source); }}>Needs attention</Button>
                : source.update_available ? <Button size="sm" variant="tinted" onClick={() => { setSourceActionError(''); setSourceDetail(source); }}>Update available</Button>
                  : <span>{source.item_count} item{source.item_count === 1 ? '' : 's'}</span>}
            </header>
            <div>{items.length ? rows(items) : <div className="code-skill-group__empty">{source.error ? 'Source unavailable — open for details.' : query.trim() ? 'No items match this search.' : 'No shared items found.'}</div>}</div>
          </section>;
        })}
        {(filter === 'all' || filter === 'personal') && personal.length > 0 && <section className="code-skill-group"><header><div><strong>Yours</strong><small>Personal skills available in Code Mode</small></div><span>{personal.length}</span></header><div>{rows(personal)}</div></section>}
        {(filter === 'all' || filter === 'built_in') && builtIn.length > 0 && <section className="code-skill-group"><header><div><strong>MindsHub</strong><small>Engineering skills maintained by MindsHub</small></div><span>{builtIn.length}</span></header><div>{rows(builtIn)}</div></section>}
        {!library.items.length && !library.sources.length && <div className="code-skills-empty"><span>{Ico.cube(20)}</span><strong>No team skills yet</strong><p>Add a Git repository once, then choose which projects use each item.</p><Button variant="subtle" onClick={() => setAddOpen(true)}>Add team source</Button></div>}
        {!hasVisibleCatalog && (library.sources.length > 0 || library.items.length > 0) && <div className="code-skills-empty">{query.trim() ? 'No skills match your search.' : 'No skills in this view.'}</div>}
      </div>}

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
    </main>
  );
}
