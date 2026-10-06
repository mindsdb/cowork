import { useMemo, useRef, useState } from 'react';
import Ico from '../components/Icons';
import {
  CollectionState, FilterRow, HoverActions, ListGroup, ListItem, PageHeader, SearchInput, StatusDot, useCollectionShortcut,
  type StatusTone,
} from '../components/collection';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import { projectResources, type CodeProject, type CodingSession } from './api';
import { codingSessionStatus, relativeTime } from './presentation';
import './code-tasks.css';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'accent', label: 'In progress' },
  { value: 'success', label: 'Completed' },
  { value: 'danger', label: 'Failed' },
  { value: 'neutral', label: 'Ready or stopped' },
];

const TONE: Record<ReturnType<typeof codingSessionStatus>['tone'], StatusTone> = {
  warning: 'warning', accent: 'accent', success: 'success', danger: 'danger', neutral: 'muted',
};

export function CodeTasksView({
  sessions, projects, projectId = null, active = true, loading, error,
  onOpen, onOpenProject, onNewTask, onEditProject, onBack, onRetry,
}: {
  sessions: CodingSession[];
  projects: CodeProject[];
  projectId?: string | null;
  active?: boolean;
  loading: boolean;
  error: string;
  onOpen: (id: string) => void;
  onOpenProject: (id: string) => void;
  onNewTask: (projectId: string | null) => void;
  onEditProject: (id: string) => void;
  onBack: () => void;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [archiveFilter, setArchiveFilter] = useState('current');
  const inputRef = useRef<HTMLInputElement>(null);
  useCollectionShortcut(inputRef, active);

  const projectNames = useMemo(() => {
    // Include removed projects in the filter so their task history stays
    // findable. IDs, not names, distinguish projects with the same name.
    const names = new Map<string, string>();
    for (const task of sessions) {
      if (task.project_id) names.set(task.project_id, task.project_name || 'Unavailable project');
    }
    for (const project of projects) names.set(project.id, project.name);
    return names;
  }, [projects, sessions]);
  const projectOptions = useMemo(() => {
    const nameCounts = new Map<string, number>();
    for (const name of projectNames.values()) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    const options = Array.from(projectNames, ([value, name]) => {
      if (nameCounts.get(name) === 1) return { value, label: name };
      const project = projects.find(item => item.id === value);
      const resource = project && projectResources(project)[0];
      const task = sessions.find(item => item.project_id === value);
      const location = resource
        ? resource.kind === 'repository' ? resource.local_path || resource.source_url || resource.name : resource.path
        : task?.repository_root || task?.source_path;
      return { value, label: `${name} — ${location || value}` };
    });
    // Shared locations (or missing metadata) must not reintroduce ambiguity.
    return options.map(option => {
      const label = options.some(other => other.value !== option.value && other.label === option.label)
        ? `${option.label} (${option.value})` : option.label;
      return { ...option, label, title: label };
    }).sort((a, b) => a.label.localeCompare(b.label));
  }, [projects, sessions, projectNames]);
  const project = projects.find(item => item.id === projectId);
  const scope = projectId || projectFilter;
  const newTaskProjectId = scope === 'all' || scope === 'none' ? null : scope;
  const canCreate = !newTaskProjectId || projects.some(item => item.id === newTaskProjectId);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return sessions.filter(task => {
      const tone = codingSessionStatus(task).tone;
      // Queued work is in progress even though its status dot is neutral.
      const group = tone === 'neutral' && task.run_status === 'queued' ? 'accent' : tone;
      return (
      (archiveFilter === 'archived' ? task.archived : !task.archived)
      && (scope === 'all' || (scope === 'none' ? !task.project_id : task.project_id === scope))
      && (statusFilter === 'all' || (statusFilter === 'attention'
        ? ['warning', 'danger'].includes(group)
        : group === statusFilter))
      && (!search || [task.title, task.project_id ? projectNames.get(task.project_id) : '', task.repository_root, task.source_path]
        .some(value => value?.toLowerCase().includes(search)))
      );
    }).sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  }, [sessions, scope, archiveFilter, statusFilter, query, projectNames]);
  // Search and filters narrow this; zero here is "nothing yet", not "no match".
  const total = useMemo(() => sessions.filter(task => (archiveFilter === 'archived' ? task.archived : !task.archived)
    && (!projectId || task.project_id === projectId)).length, [sessions, archiveFilter, projectId]);

  return (
    <main className="code-tasks-view">
      {projectId && <div className="code-tasks-view__back"><Button variant="subtle" size="sm" onClick={onBack}>{Ico.chevLeft(13)} Projects</Button></div>}
      <div className={`code-tasks-view__header${projectId ? ' code-tasks-view__header--project' : ''}`}><PageHeader
        title={projectId ? projectNames.get(projectId) || 'Unavailable project' : 'All tasks'}
        subtitle={projectId ? 'Coding tasks in this project.' : undefined}
        actions={<div className="code-tasks-view__actions">
          {project && <Button icon variant="subtle" aria-label={`Edit ${project.name}`} onClick={() => onEditProject(project.id)}>{Ico.settings(15)}</Button>}
          <Button variant="primary" disabled={!canCreate || loading} onClick={() => onNewTask(newTaskProjectId)}>{Ico.plus(13)} New task</Button>
        </div>}
      /></div>
      <FilterRow
        search={<SearchInput value={query} onChange={setQuery} inputRef={inputRef} placeholder="Search tasks" />}
        sort={<>
          {!projectId && <Select className="code-tasks-view__project-filter" variant="pill" label="Project" ariaLabel="Filter by project" value={projectFilter} onValueChange={setProjectFilter} options={[
            { value: 'all', label: 'All projects' }, { value: 'none', label: 'No project' },
            ...projectOptions,
          ]} />}
          <Select variant="pill" label="Status" ariaLabel="Filter by status" value={statusFilter} onValueChange={setStatusFilter} options={STATUS_OPTIONS} />
          <Select variant="pill" label="Show" ariaLabel="Task history" value={archiveFilter} onValueChange={setArchiveFilter} options={[
            { value: 'current', label: 'Unarchived' }, { value: 'archived', label: 'Archived' },
          ]} />
        </>}
        counts={!loading && !error ? `${filtered.length} ${filtered.length === 1 ? 'task' : 'tasks'} · Most recently updated first` : undefined}
      />
      <div className="mx-8 mt-5 grid gap-4">
        {error && <Alert variant="danger">{error}<div className="mt-2"><Button variant="subtle" size="sm" onClick={onRetry}>Try again</Button></div></Alert>}
        {/* A failed load shows the error alone, never an empty state. */}
        {!(error && !sessions.length) && <CollectionState
          loading={loading && !sessions.length}
          skeleton="group"
          skeletonCount={4}
          total={total}
          shown={filtered.length}
          noMatchTitle="No matching tasks"
          clearLabel="Clear filters"
          onClear={() => { setQuery(''); setProjectFilter('all'); setStatusFilter('all'); }}
          empty={archiveFilter === 'archived'
            ? { title: 'No archived tasks', description: 'Tasks you archive will appear here.' }
            : { icon: Ico.code(20), title: 'No tasks yet', description: 'Start a task to begin working on your code.' }}
        >
          <ListGroup density="compact" aria-label={projectId ? 'Project tasks' : 'Code tasks'}>
            {filtered.map(task => {
              const status = codingSessionStatus(task);
              const name = task.project_id ? projectNames.get(task.project_id) : undefined;
              return <ListItem
                key={task.id}
                title={task.title || 'Untitled task'}
                onActivate={() => onOpen(task.id)}
                activateLabel={task.title || 'Untitled task'}
                meta={<span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  {!projectId && (name
                    ? <HoverActions reveal className="min-w-0 max-w-[12rem] shrink max-sm:max-w-[8rem]">
                      <button type="button" title={name} onClick={() => onOpenProject(task.project_id!)}
                        className="m-0 min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-body text-xs text-ink-3 hover:text-accent hover:underline hover:underline-offset-2">{name}</button>
                    </HoverActions>
                    : <span>No project</span>)}
                  <StatusDot tone={TONE[status.tone]}>{status.label}</StatusDot>
                  <time dateTime={task.updated_at} title={new Date(task.updated_at).toLocaleString()}>{relativeTime(task.updated_at)}</time>
                </span>}
              />;
            })}
          </ListGroup>
        </CollectionState>}
      </div>
    </main>
  );
}
